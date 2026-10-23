import {
  BadRequestException,
  HttpException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { AgentOrchestrator } from '../agent/agent.orchestrator';
import { AgentResponseDto } from '../agent/dto/agent-response.dto';
import {
  AmbiguousCustomerError,
  CustomerNotFoundError,
} from '../billing/domain/billing.errors';
import {
  CREATE_INVOICE_USE_CASE,
  GET_RECEIPT_USE_CASE,
  REGISTER_PAYMENT_USE_CASE,
  type CreateInvoiceUseCasePort,
  type GetReceiptUseCasePort,
  type RegisterPaymentUseCasePort,
} from '../billing/ports/billing-use-cases.port';
import { InvoiceQueryService } from '../billing/queries/invoice-query.service';
import { ERROR_CATALOG, isCatalogError } from '../common/errors/error-catalog';
import { maskDocument } from '../common/utils/mask-document.util';
import { CustomersService } from '../customers/customers.service';
import type { Partner } from '../partners/partner.entity';
import { isPartnerSkill, type PartnerSkill } from '../partners/skills';
import { ReceiptLinkService } from '../receipts/receipt-link.service';
import { SkillNotAllowedError } from './a2a.errors';
import { describeInvoice, isInvoiceData } from './answers';
import { ExchangeAuditService } from './exchange-audit.service';
import {
  MAX_IDEMPOTENCY_KEY_CHARS,
  consultarComprobanteParams,
  consultarCuentaParams,
  crearCuentaParams,
  parseOrReject,
  registrarClienteParams,
  registrarPagoParams,
  taskSchema,
  type Task,
} from './task.schema';

export interface TaskContext {
  requestId: string;
  // Encabezado Idempotency-Key, si vino.
  idempotencyKey?: string;
}

// Respuesta del canal: el envoltorio del contrato (sección 7.4) más `answer`, un
// texto listo para mostrar que el chatbot del otro negocio lee primero.
export type A2aResponse = AgentResponseDto & { answer: string };

const PAYMENT_LABELS = {
  cash: 'en efectivo',
  card: 'con tarjeta',
  transfer: 'por transferencia',
} as const;

// Ejecuta las tareas de un negocio. Cada habilidad trabaja SIEMPRE dentro del
// ámbito del negocio (partnerId): sus clientes, sus cuentas, sus comprobantes.
@Injectable()
export class TasksService {
  constructor(
    private readonly orchestrator: AgentOrchestrator,
    private readonly customers: CustomersService,
    private readonly invoices: InvoiceQueryService,
    @Inject(CREATE_INVOICE_USE_CASE)
    private readonly createInvoice: CreateInvoiceUseCasePort,
    @Inject(REGISTER_PAYMENT_USE_CASE)
    private readonly registerPayment: RegisterPaymentUseCasePort,
    @Inject(GET_RECEIPT_USE_CASE)
    private readonly getReceipt: GetReceiptUseCasePort,
    private readonly audit: ExchangeAuditService,
    private readonly receiptLinks: ReceiptLinkService,
  ) {}

  async handle(
    partner: Partner,
    body: unknown,
    context: TaskContext,
  ): Promise<A2aResponse> {
    const startedAt = Date.now();
    let skill = 'desconocida';
    let summary: string | null = null;

    try {
      const task = parseOrReject(taskSchema, body);
      const chosen: PartnerSkill = task.skill ?? 'lenguaje_natural';
      skill = chosen;
      summary = chosen === 'lenguaje_natural' ? (task.message ?? null) : null;

      if (!partner.skills.includes(chosen)) {
        throw new SkillNotAllowedError(chosen);
      }

      const idempotencyKey = this.scopeKey(
        partner,
        context.idempotencyKey ?? task.idempotency_key,
      );
      const response = this.attachReceiptLink(
        await this.run(partner, chosen, task, {
          requestId: context.requestId,
          idempotencyKey,
        }),
      );

      void this.audit.record({
        partnerId: partner.id,
        requestId: context.requestId,
        skill,
        status: response.status,
        errorCode: errorCodeOf(response.data),
        httpStatus: 200,
        latencyMs: Date.now() - startedAt,
        summary,
      });
      return response;
    } catch (error) {
      const failure = describeFailure(error);
      void this.audit.record({
        partnerId: partner.id,
        requestId: context.requestId,
        skill: isPartnerSkill(skill) ? skill : 'desconocida',
        status: failure.status,
        errorCode: failure.code,
        httpStatus: failure.httpStatus,
        latencyMs: Date.now() - startedAt,
        summary,
      });
      throw error;
    }
  }

  // Toda respuesta completada con un comprobante lleva el enlace a su PDF, tanto en
  // `data.receipt.pdf_url` como al final de `answer` (el chat del negocio solo muestra
  // ese texto). Se calcula en cada respuesta, también en las repetidas por idempotencia,
  // así que el enlace siempre llega vigente.
  private attachReceiptLink(response: A2aResponse): A2aResponse {
    if (response.status !== 'completed' || !isInvoiceData(response.data)) {
      return response;
    }
    const receipt = response.data.receipt;
    if (!receipt) return response;
    const pdfUrl = this.receiptLinks.urlFor(receipt.receipt_number);
    receipt.pdf_url = pdfUrl;
    response.answer = `${response.answer} Comprobante en PDF: ${pdfUrl}`;
    return response;
  }

  private async run(
    partner: Partner,
    skill: PartnerSkill,
    task: Task,
    context: { requestId: string; idempotencyKey?: string },
  ): Promise<A2aResponse> {
    switch (skill) {
      case 'lenguaje_natural':
        return this.naturalLanguage(partner, task.message ?? '', context);
      case 'registrar_cliente':
        return this.registerCustomer(partner, task.params, context);
      case 'crear_cuenta':
        return this.createAccount(partner, task.params, context);
      case 'registrar_pago':
        return this.payAccount(partner, task.params, context);
      case 'consultar_cuenta':
        return this.consultAccount(partner, task.params, context);
      case 'consultar_comprobante':
        return this.consultReceipt(partner, task.params, context);
    }
  }

  // Texto libre: el mismo flujo que POST /agent/requests, dentro del negocio.
  private async naturalLanguage(
    partner: Partner,
    text: string,
    context: { requestId: string; idempotencyKey?: string },
  ): Promise<A2aResponse> {
    const response = await this.orchestrator.handle({
      text,
      requestId: context.requestId,
      idempotencyKey: context.idempotencyKey,
      partnerId: partner.id,
    });
    return withAnswer(response);
  }

  private async registerCustomer(
    partner: Partner,
    rawParams: unknown,
    context: { requestId: string },
  ): Promise<A2aResponse> {
    const params = parseOrReject(registrarClienteParams, rawParams ?? {});
    const { customer, created } = await this.customers.register({
      partnerId: partner.id,
      documentType: params.document_type,
      documentNumber: params.document_number,
      fullName: params.full_name,
    });
    const message = created
      ? 'Cliente registrado.'
      : 'El cliente ya estaba registrado; no se modificó.';
    return withAnswer(
      AgentResponseDto.completed(context.requestId, message, {
        customer: {
          document_type: customer.document_type,
          document_number: maskDocument(customer.document_number),
          full_name: customer.full_name,
        },
        created,
      }),
    );
  }

  private async createAccount(
    partner: Partner,
    rawParams: unknown,
    context: { requestId: string; idempotencyKey?: string },
  ): Promise<A2aResponse> {
    const params = parseOrReject(crearCuentaParams, rawParams ?? {});
    if (!context.idempotencyKey)
      return missingIdempotencyKey(context.requestId);

    const customerId = await this.resolveCustomerId(partner, params.customer);
    const result = await this.createInvoice.execute({
      customerId,
      items: params.items.map((item) => ({
        description: item.description,
        quantity: item.quantity,
        unitPrice: item.unit_price,
      })),
      payment: params.payment
        ? {
            method: params.payment.method,
            amount: params.payment.amount ?? null,
          }
        : null,
      idempotencyKey: context.idempotencyKey,
      source: 'direct',
      externalRef: params.external_ref ?? null,
      partnerId: partner.id,
    });
    const message = result.payment
      ? `Cuenta de cobro creada y pagada ${PAYMENT_LABELS[result.payment.method]}.`
      : 'Cuenta de cobro creada; queda pendiente de pago.';
    return withAnswer(
      AgentResponseDto.completed(context.requestId, message, result),
    );
  }

  private async payAccount(
    partner: Partner,
    rawParams: unknown,
    context: { requestId: string; idempotencyKey?: string },
  ): Promise<A2aResponse> {
    const params = parseOrReject(registrarPagoParams, rawParams ?? {});
    if (!context.idempotencyKey)
      return missingIdempotencyKey(context.requestId);

    const result = await this.registerPayment.execute({
      invoiceId: params.invoice_id,
      method: params.method,
      amount: params.amount ?? null,
      idempotencyKey: context.idempotencyKey,
      partnerId: partner.id,
    });
    return withAnswer(
      AgentResponseDto.completed(
        context.requestId,
        `Pago registrado ${PAYMENT_LABELS[params.method]}.`,
        result,
      ),
    );
  }

  private async consultAccount(
    partner: Partner,
    rawParams: unknown,
    context: { requestId: string },
  ): Promise<A2aResponse> {
    const params = parseOrReject(consultarCuentaParams, rawParams ?? {});
    const result = await this.invoices.getResultById(
      params.invoice_id,
      partner.id,
    );
    return withAnswer(
      AgentResponseDto.completed(
        context.requestId,
        result.payment
          ? 'Cuenta de cobro encontrada; está pagada.'
          : 'Cuenta de cobro encontrada; está pendiente de pago.',
        result,
      ),
    );
  }

  private async consultReceipt(
    partner: Partner,
    rawParams: unknown,
    context: { requestId: string },
  ): Promise<A2aResponse> {
    const params = parseOrReject(consultarComprobanteParams, rawParams ?? {});
    const scope = { partnerId: partner.id };
    const result = await this.getReceipt.execute(
      params.receipt_number !== undefined
        ? { receiptNumber: params.receipt_number, ...scope }
        : { invoiceId: params.invoice_id as string, ...scope },
    );
    const number = result.receipt?.receipt_number;
    return withAnswer(
      AgentResponseDto.completed(
        context.requestId,
        number
          ? `Comprobante ${number} encontrado.`
          : 'Comprobante encontrado.',
        result,
      ),
    );
  }

  // RN-01 y RN-02 dentro del negocio. Con tipo y nombre entregados de forma
  // estructurada por el negocio, un cliente nuevo se registra en el mismo paso
  // (nunca con datos que extrajo el modelo).
  private async resolveCustomerId(
    partner: Partner,
    customer: {
      document_type?: 'CC' | 'NIT' | 'CE';
      document_number: string;
      full_name?: string;
    },
  ): Promise<string> {
    const matches = await this.customers.findByDocument(
      customer.document_type ?? null,
      customer.document_number,
      partner.id,
    );
    if (matches.length > 1) throw new AmbiguousCustomerError();
    if (matches.length === 1) return matches[0].id;

    if (customer.document_type && customer.full_name) {
      const { customer: created } = await this.customers.register({
        partnerId: partner.id,
        documentType: customer.document_type,
        documentNumber: customer.document_number,
        fullName: customer.full_name,
      });
      return created.id;
    }
    throw new CustomerNotFoundError(
      'El cliente no está registrado en este negocio. Regístralo con la habilidad registrar_cliente, o envía document_type y full_name junto con la cuenta.',
    );
  }

  // La clave de idempotencia es del negocio: se antepone su identificador para
  // que dos negocios nunca choquen (ni puedan leer la cuenta del otro) usando
  // la misma clave.
  private scopeKey(
    partner: Partner,
    raw: string | undefined,
  ): string | undefined {
    if (raw === undefined) return undefined;
    const key = raw.trim();
    if (
      key.length === 0 ||
      key.length > MAX_IDEMPOTENCY_KEY_CHARS ||
      !/^[\x21-\x7e]+$/.test(key)
    ) {
      throw new BadRequestException({
        message: `Idempotency-Key inválida: usa de 1 a ${MAX_IDEMPOTENCY_KEY_CHARS} caracteres visibles, sin espacios.`,
        missing_fields: ['Idempotency-Key'],
      });
    }
    return `${partner.slug}:${key}`;
  }
}

function withAnswer(response: AgentResponseDto): A2aResponse {
  const answer =
    response.status === 'completed' && isInvoiceData(response.data)
      ? describeInvoice(response.message, response.data)
      : response.message;
  return Object.assign(response, { answer });
}

function missingIdempotencyKey(requestId: string): A2aResponse {
  return withAnswer(
    AgentResponseDto.needsClarification(
      requestId,
      'Falta el encabezado Idempotency-Key para crear o pagar.',
      ['Idempotency-Key'],
    ),
  );
}

function errorCodeOf(data: unknown): string | null {
  return typeof data === 'object' &&
    data !== null &&
    'error_code' in data &&
    typeof data.error_code === 'string'
    ? data.error_code
    : null;
}

// Cómo quedó un intercambio que terminó en excepción, para la bitácora. Replica a
// grandes rasgos lo que hará el filtro global; no decide la respuesta HTTP.
function describeFailure(error: unknown): {
  status: string;
  code: string;
  httpStatus: number;
} {
  if (isCatalogError(error)) {
    const entry = ERROR_CATALOG[error.code];
    const business = 'business' in entry;
    return {
      status: entry.status,
      code: error.code,
      httpStatus: business
        ? 200
        : (error.httpStatus ?? (error.timedOut ? 504 : entry.httpStatus)),
    };
  }
  if (error instanceof HttpException) {
    const httpStatus = error.getStatus();
    return {
      status: 'rejected',
      code:
        httpStatus === 409
          ? 'IDEMPOTENCY_CONFLICT'
          : httpStatus === 403
            ? 'SKILL_NOT_ALLOWED'
            : 'VALIDATION_ERROR',
      httpStatus,
    };
  }
  return { status: 'error', code: 'INTERNAL_ERROR', httpStatus: 500 };
}
