import {
  AmbiguousCustomerError,
  CustomerNotFoundError,
  InvalidAmountError,
  MissingFieldsError,
  PaymentMismatchError,
  TotalExceedsLimitError,
  UnknownIntentError,
} from './billing.errors';
import { InvoiceStatus } from './invoice-status.enum';
import { Money } from './money';

// Reglas de negocio RN-01 a RN-11 (contrato, sección 8.2) como funciones puras.
// No consultan la base de datos: reciben lo que necesitan ya resuelto y lanzan
// el error de dominio que corresponde. RN-07 vive en assertPayable
// (invoice-status.enum.ts). Las rutas de campo siguen las del mapper del agente.

export const MAX_DESCRIPTION_LENGTH = 200;

// Monto o cantidad: solo dígitos y hasta 2 decimales (sección 9.1).
export const AMOUNT_REGEX = /^\d+(\.\d{1,2})?$/;

export type PaymentMethod = 'cash' | 'card' | 'transfer';

export interface RawItem {
  description: string;
  quantity: string;
  unitPrice: string;
}

// RN-01 y RN-02: el cliente debe existir, y si el número coincide con varios
// (falta el tipo de documento) se pide aclarar. Nunca se crea un cliente.
export function resolveCustomer<T>(candidates: readonly T[]): T {
  if (candidates.length === 0) throw new CustomerNotFoundError();
  if (candidates.length > 1) throw new AmbiguousCustomerError();
  return candidates[0];
}

// RN-03: al menos un ítem; descripción de hasta 200 caracteres, cantidad mayor
// que 0 y valor unitario mayor o igual a 0.
export function validateItems(items: readonly RawItem[]): void {
  if (items.length === 0) throw new MissingFieldsError(['items']);

  items.forEach((item, index) => {
    const path = `items[${index}]`;
    const description = item.description.trim();

    if (description.length === 0) {
      throw new MissingFieldsError([`${path}.description`]);
    }
    if (description.length > MAX_DESCRIPTION_LENGTH) {
      throw new MissingFieldsError(
        [`${path}.description`],
        `La descripción del ítem supera ${MAX_DESCRIPTION_LENGTH} caracteres.`,
      );
    }
    if (!AMOUNT_REGEX.test(item.quantity) || Money.of(item.quantity).isZero()) {
      throw new InvalidAmountError(
        'La cantidad debe ser mayor que 0.',
        `${path}.quantity`,
      );
    }
    if (!AMOUNT_REGEX.test(item.unitPrice)) {
      throw new InvalidAmountError(
        'El valor unitario debe ser un monto mayor o igual a 0.',
        `${path}.unit_price`,
      );
    }
  });
}

// RN-04: el total no supera MAX_INVOICE_TOTAL.
export function assertWithinLimit(total: Money, limit: Money): void {
  if (total.isGreaterThan(limit)) {
    throw new TotalExceedsLimitError(total, limit);
  }
}

// RN-05: con método de pago la cuenta se crea ya pagada; sin él queda PENDING.
export function initialStatus(payment: object | null): InvoiceStatus {
  return payment === null ? InvoiceStatus.PENDING : InvoiceStatus.PAID;
}

// RN-06: el pago es único y completo. Monto vacío → el total; otro monto → error.
export function resolvePaymentAmount(
  total: Money,
  amount: string | null,
): Money {
  if (amount === null) return total;

  if (!AMOUNT_REGEX.test(amount)) {
    throw new InvalidAmountError(
      'El monto del pago no es válido.',
      'payment.amount',
    );
  }
  const paid = Money.of(amount);
  if (!paid.equals(total)) throw new PaymentMismatchError(total, paid);
  return paid;
}

// RN-08: register_payment requiere invoice_id, o un cliente con exactamente
// una cuenta PENDING.
export function resolveInvoiceToPay(
  invoiceId: string | null,
  pendingInvoiceIds: readonly string[],
): string {
  if (invoiceId !== null) return invoiceId;
  if (pendingInvoiceIds.length === 1) return pendingInvoiceIds[0];
  throw new MissingFieldsError(['related_ids.invoice_id']);
}

// RN-09: el comprobante se emite solo cuando la cuenta pasa a PAID.
export function shouldIssueReceipt(status: InvoiceStatus): boolean {
  return status === InvoiceStatus.PAID;
}

// RN-10: get_receipt requiere receipt_number o invoice_id.
export function assertReceiptLookup(
  receiptNumber: number | null,
  invoiceId: string | null,
): void {
  if (receiptNumber === null && invoiceId === null) {
    throw new MissingFieldsError(['related_ids.receipt_number']);
  }
}

// RN-11: la intención unknown no ejecuta nada.
export function assertKnownIntent(intent: string): void {
  if (intent === 'unknown') throw new UnknownIntentError();
}
