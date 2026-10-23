import { AMOUNT_REGEX, type Extraction } from '../llm/extraction.schema';
import type {
  CreateInvoiceCommand,
  GetReceiptQuery,
  RegisterPaymentCommand,
} from '../ports/billing-gateway.port';

// De la extracción validada a comandos del dominio. missing_fields se
// recalcula aquí: la lista del modelo es solo una pista (contrato, sección 6.2).

const MAX_DESCRIPTION_LENGTH = 200;
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ExtractionCheck {
  // Datos que el texto no trae.
  missing: string[];
  // Datos presentes pero con un valor que no se puede usar.
  invalid: string[];
}

// RN-02: la cédula o NIT queda solo con dígitos.
export function normalizeDocumentNumber(value: string | null): string | null {
  const digits = value?.replace(/\D/g, '') ?? '';
  return digits.length > 0 ? digits : null;
}

// Cantidad > 0 con hasta 2 decimales, como texto para no arrastrar floats.
function quantityToDecimal(quantity: number): string | null {
  if (!Number.isFinite(quantity) || quantity <= 0) return null;
  const text = String(quantity);
  return AMOUNT_REGEX.test(text) ? text : null;
}

function isAmount(value: string | null): value is string {
  return value !== null && AMOUNT_REGEX.test(value);
}

function checkItems(extraction: Extraction, check: ExtractionCheck): void {
  if (extraction.items.length === 0) {
    check.missing.push('items');
    return;
  }
  extraction.items.forEach((item, index) => {
    const description = item.description.trim();
    if (description.length === 0) {
      check.missing.push(`items[${index}].description`);
    } else if (description.length > MAX_DESCRIPTION_LENGTH) {
      check.invalid.push(`items[${index}].description`);
    }
    if (quantityToDecimal(item.quantity) === null) {
      check.invalid.push(`items[${index}].quantity`);
    }
    if (item.unit_price.trim() === '') {
      check.missing.push(`items[${index}].unit_price`);
    } else if (!isAmount(item.unit_price)) {
      check.invalid.push(`items[${index}].unit_price`);
    }
  });
}

function checkPaymentAmount(
  extraction: Extraction,
  check: ExtractionCheck,
): void {
  const { amount } = extraction.payment;
  if (amount !== null && !isAmount(amount)) {
    check.invalid.push('payment.amount');
  }
}

function checkInvoiceId(extraction: Extraction, check: ExtractionCheck): void {
  const { invoice_id } = extraction.related_ids;
  if (invoice_id !== null && !UUID_REGEX.test(invoice_id)) {
    check.invalid.push('related_ids.invoice_id');
  }
}

// Qué falta o sobra para ejecutar la intención (RN-03, RN-08, RN-10).
export function checkExtraction(extraction: Extraction): ExtractionCheck {
  const check: ExtractionCheck = { missing: [], invalid: [] };
  const documentNumber = normalizeDocumentNumber(
    extraction.customer.document_number,
  );

  switch (extraction.intent) {
    case 'create_invoice':
      if (documentNumber === null)
        check.missing.push('customer.document_number');
      checkItems(extraction, check);
      checkPaymentAmount(extraction, check);
      break;

    case 'register_payment':
      checkInvoiceId(extraction, check);
      // RN-08: invoice_id, o un cliente con una sola cuenta PENDING.
      if (
        extraction.related_ids.invoice_id === null &&
        documentNumber === null
      ) {
        check.missing.push('related_ids.invoice_id');
      }
      if (extraction.payment.method === null)
        check.missing.push('payment.method');
      checkPaymentAmount(extraction, check);
      break;

    case 'get_receipt': {
      checkInvoiceId(extraction, check);
      const { receipt_number, invoice_id } = extraction.related_ids;
      if (receipt_number !== null && receipt_number <= 0) {
        check.invalid.push('related_ids.receipt_number');
      }
      if (receipt_number === null && invoice_id === null) {
        check.missing.push('related_ids.receipt_number');
      }
      break;
    }

    case 'unknown':
      break;
  }
  return check;
}

// Las funciones siguientes asumen una extracción que ya pasó checkExtraction.

export function toCreateInvoiceCommand(
  extraction: Extraction,
  customerId: string,
  idempotencyKey: string,
): CreateInvoiceCommand {
  const { method, amount } = extraction.payment;
  return {
    customerId,
    items: extraction.items.map((item) => ({
      description: item.description.trim(),
      quantity: quantityToDecimal(item.quantity) as string,
      unitPrice: item.unit_price,
    })),
    payment: method === null ? null : { method, amount },
    idempotencyKey,
    source: 'agent',
    externalRef: extraction.related_ids.external_ref,
  };
}

export function toRegisterPaymentCommand(
  extraction: Extraction,
  invoiceId: string,
  idempotencyKey: string,
): RegisterPaymentCommand {
  return {
    invoiceId,
    method: extraction.payment.method!,
    amount: extraction.payment.amount,
    idempotencyKey,
  };
}

export function toGetReceiptQuery(extraction: Extraction): GetReceiptQuery {
  const { receipt_number, invoice_id } = extraction.related_ids;
  return receipt_number !== null
    ? { receiptNumber: receipt_number }
    : { invoiceId: invoice_id! };
}
