import { Inject, Injectable } from '@nestjs/common';
import { AgentOutcomeError, toBusinessResponse } from './agent-outcome';
import {
  AgentResponseDto,
  type InvoiceResultData,
} from './dto/agent-response.dto';
import type { Extraction, PaymentMethod } from './llm/extraction.schema';
import { LLM_EXTRACTOR, type LlmExtractorPort } from './llm/llm-extractor.port';
import { maskDigits } from './llm/mask-llm-text';
import {
  checkExtraction,
  normalizeDocumentNumber,
  toCreateInvoiceCommand,
  toGetReceiptQuery,
  toRegisterPaymentCommand,
} from './mappers/extraction-to-command.mapper';
import {
  BILLING_GATEWAY,
  type BillingGateway,
} from './ports/billing-gateway.port';
import {
  CUSTOMER_LOOKUP,
  type CustomerLookup,
  type CustomerSummary,
} from './ports/customer-lookup.port';

export interface AgentRequest {
  text: string;
  requestId: string;
  idempotencyKey: string;
}

const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: 'en efectivo',
  card: 'con tarjeta',
  transfer: 'por transferencia',
};

// Caso de uso del camino con IA (contrato, sección 2.1): extrae, valida,
// resuelve el cliente, invoca el dominio y arma el envoltorio. Devuelve
// completed, needs_clarification o rejected; los fallos técnicos
// (LLM_UNAVAILABLE, base de datos) se relanzan para el filtro global.
@Injectable()
export class AgentOrchestrator {
  constructor(
    @Inject(LLM_EXTRACTOR) private readonly extractor: LlmExtractorPort,
    @Inject(CUSTOMER_LOOKUP) private readonly customers: CustomerLookup,
    @Inject(BILLING_GATEWAY) private readonly billing: BillingGateway,
  ) {}

  async handle(request: AgentRequest): Promise<AgentResponseDto> {
    try {
      const extraction = await this.extractor.extract(request.text, {
        requestId: request.requestId,
      });
      return await this.execute(extraction, request);
    } catch (error) {
      const response = toBusinessResponse(error, request.requestId);
      if (response) return response;
      throw error;
    }
  }

  private async execute(
    extraction: Extraction,
    request: AgentRequest,
  ): Promise<AgentResponseDto> {
    // RN-11: unknown no ejecuta nada.
    if (extraction.intent === 'unknown') {
      throw new AgentOutcomeError('UNKNOWN_INTENT');
    }

    // Nada se escribe si falta o sobra un dato (contrato, sección 2.1 paso 5).
    const check = checkExtraction(extraction);
    if (check.invalid.length > 0) {
      throw new AgentOutcomeError('INVALID_AMOUNT', undefined, [
        ...check.invalid,
        ...check.missing,
      ]);
    }
    if (check.missing.length > 0) {
      throw new AgentOutcomeError(
        'MISSING_FIELDS',
        missingFieldsMessage(check.missing),
        check.missing,
      );
    }

    switch (extraction.intent) {
      case 'create_invoice':
        return this.createInvoice(extraction, request);
      case 'register_payment':
        return this.registerPayment(extraction, request);
      case 'get_receipt':
        return this.getReceipt(extraction, request);
    }
  }

  private async createInvoice(
    extraction: Extraction,
    request: AgentRequest,
  ): Promise<AgentResponseDto> {
    const customer = await this.resolveCustomer(extraction);
    const result = await this.billing.createInvoice(
      toCreateInvoiceCommand(extraction, customer.id, request.idempotencyKey),
    );
    const message = result.payment
      ? `Cuenta de cobro creada y pagada ${PAYMENT_METHOD_LABELS[result.payment.method]}.`
      : 'Cuenta de cobro creada; queda pendiente de pago.';
    return AgentResponseDto.completed(
      request.requestId,
      message,
      maskCustomer(result),
    );
  }

  private async registerPayment(
    extraction: Extraction,
    request: AgentRequest,
  ): Promise<AgentResponseDto> {
    const invoiceId =
      extraction.related_ids.invoice_id ??
      (await this.findSinglePendingInvoice(extraction));
    const result = await this.billing.registerPayment(
      toRegisterPaymentCommand(extraction, invoiceId, request.idempotencyKey),
    );
    const method = result.payment?.method ?? extraction.payment.method!;
    return AgentResponseDto.completed(
      request.requestId,
      `Pago registrado ${PAYMENT_METHOD_LABELS[method]}.`,
      maskCustomer(result),
    );
  }

  private async getReceipt(
    extraction: Extraction,
    request: AgentRequest,
  ): Promise<AgentResponseDto> {
    const result = await this.billing.getReceipt(toGetReceiptQuery(extraction));
    const number = result.receipt?.receipt_number;
    return AgentResponseDto.completed(
      request.requestId,
      number ? `Comprobante ${number} encontrado.` : 'Comprobante encontrado.',
      maskCustomer(result),
    );
  }

  // RN-01 y RN-02: el cliente debe existir y ser uno solo.
  private async resolveCustomer(
    extraction: Extraction,
  ): Promise<CustomerSummary> {
    const documentNumber = normalizeDocumentNumber(
      extraction.customer.document_number,
    );
    if (documentNumber === null) {
      throw new AgentOutcomeError(
        'MISSING_FIELDS',
        missingFieldsMessage(['customer.document_number']),
        ['customer.document_number'],
      );
    }
    const matches = await this.customers.findByDocument(
      extraction.customer.document_type,
      documentNumber,
    );
    if (matches.length === 0) throw new AgentOutcomeError('CUSTOMER_NOT_FOUND');
    if (matches.length > 1) {
      throw new AgentOutcomeError('AMBIGUOUS_CUSTOMER', undefined, [
        'customer.document_type',
      ]);
    }
    return matches[0];
  }

  // RN-08: sin invoice_id, el cliente debe tener exactamente una cuenta PENDING.
  private async findSinglePendingInvoice(
    extraction: Extraction,
  ): Promise<string> {
    const customer = await this.resolveCustomer(extraction);
    const pending = await this.billing.findPendingInvoiceIds(customer.id);
    if (pending.length === 1) return pending[0];
    throw new AgentOutcomeError(
      'MISSING_FIELDS',
      pending.length === 0
        ? 'El cliente no tiene cuentas pendientes; indica la cuenta a pagar.'
        : 'El cliente tiene varias cuentas pendientes; indica cuál se paga.',
      ['related_ids.invoice_id'],
    );
  }
}

const FIELD_LABELS: Record<string, string> = {
  'customer.document_number': 'el número de documento del cliente',
  'customer.document_type': 'el tipo de documento del cliente',
  items: 'los ítems a cobrar',
  'payment.method': 'el método de pago',
  'related_ids.invoice_id': 'la cuenta de cobro',
  'related_ids.receipt_number': 'el número de comprobante o la cuenta',
};

function missingFieldsMessage(fields: string[]): string {
  const labels = [
    ...new Set(
      fields.map(
        (field) =>
          FIELD_LABELS[field] ??
          (field.startsWith('items[') ? 'datos de los ítems' : field),
      ),
    ),
  ];
  const list =
    labels.length > 1
      ? `${labels.slice(0, -1).join(', ')} y ${labels[labels.length - 1]}`
      : labels[0];
  return `Falta ${list}.`;
}

// Las respuestas solo devuelven el documento enmascarado (contrato, sección 10.1).
// billing ya devuelve el documento enmascarado; aquí solo se enmascara si llegó
// completo, sin volver a tocar uno ya enmascarado (****6789 quedaría ****).
function maskCustomer(result: InvoiceResultData): InvoiceResultData {
  const documentNumber = result.customer.document_number;
  return {
    ...result,
    customer: {
      ...result.customer,
      document_number: documentNumber.startsWith('****')
        ? documentNumber
        : maskDigits(documentNumber),
    },
  };
}
