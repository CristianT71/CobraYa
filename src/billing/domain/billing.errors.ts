import type { ErrorCode } from '../../common/errors/error-catalog';
import type { InvoiceStatus } from './invoice-status.enum';
import type { Money } from './money';

// Errores de dominio tipados (contrato, secciones 8.2 y 9.1). Cada uno lleva
// `code` del catálogo: el orquestador y el filtro global los traducen a
// completed / needs_clarification / rejected / error sin interpretar el texto.
// Solo se importan tipos: el dominio sigue sin depender de NestJS ni de TypeORM.

export type BillingErrorCode = Extract<
  ErrorCode,
  | 'CUSTOMER_NOT_FOUND'
  | 'AMBIGUOUS_CUSTOMER'
  | 'MISSING_FIELDS'
  | 'UNKNOWN_INTENT'
  | 'INVALID_AMOUNT'
  | 'TOTAL_EXCEEDS_LIMIT'
  | 'PAYMENT_MISMATCH'
  | 'INVOICE_NOT_PAYABLE'
  | 'INVOICE_NOT_FOUND'
  | 'RECEIPT_NOT_FOUND'
  | 'INTERNAL_ERROR'
>;

export abstract class BillingError extends Error {
  abstract readonly code: BillingErrorCode;
  constructor(
    message: string,
    // Rutas como "customer.document_number", para needs_clarification.
    readonly missingFields: string[] = [],
  ) {
    super(message);
    this.name = new.target.name;
  }
}

// RN-01: el cliente debe existir; el servicio nunca lo crea con datos del LLM.
export class CustomerNotFoundError extends BillingError {
  readonly code = 'CUSTOMER_NOT_FOUND';

  constructor(message = 'El cliente no existe.') {
    super(message);
  }
}

// RN-02: varios clientes coinciden con el número y falta el tipo de documento.
export class AmbiguousCustomerError extends BillingError {
  readonly code = 'AMBIGUOUS_CUSTOMER';

  constructor(
    message = 'Varios clientes coinciden con ese número; indique el tipo de documento.',
  ) {
    super(message, ['customer.document_type']);
  }
}

// RN-03, RN-08, RN-10: faltan datos obligatorios.
export class MissingFieldsError extends BillingError {
  readonly code = 'MISSING_FIELDS';

  constructor(missingFields: string[], message?: string) {
    super(
      message ?? `Faltan datos obligatorios: ${missingFields.join(', ')}.`,
      missingFields,
    );
  }
}

// RN-11: la intención unknown no ejecuta nada.
export class UnknownIntentError extends BillingError {
  readonly code = 'UNKNOWN_INTENT';

  constructor(message = 'No se reconoció la intención de la solicitud.') {
    super(message);
  }
}

// RN-03 y monto fuera del formato ^\d+(\.\d{1,2})?$.
export class InvalidAmountError extends BillingError {
  readonly code = 'INVALID_AMOUNT';

  constructor(message = 'El monto no es válido.', field?: string) {
    super(message, field ? [field] : []);
  }
}

// RN-04: el total no supera MAX_INVOICE_TOTAL.
export class TotalExceedsLimitError extends BillingError {
  readonly code = 'TOTAL_EXCEEDS_LIMIT';

  constructor(
    readonly total: Money,
    readonly limit: Money,
  ) {
    super(
      `El total ${total.toString()} supera el máximo permitido de ${limit.toString()}.`,
    );
  }
}

// RN-06: el pago es único y completo; su monto debe ser igual al total.
export class PaymentMismatchError extends BillingError {
  readonly code = 'PAYMENT_MISMATCH';

  constructor(
    readonly expected: Money,
    readonly received: Money,
  ) {
    super(
      `El pago ${received.toString()} debe ser igual al total ${expected.toString()}.`,
    );
  }
}

// RN-07: solo una cuenta PENDING admite pago.
export class InvoiceNotPayableError extends BillingError {
  readonly code = 'INVOICE_NOT_PAYABLE';

  constructor(readonly status: InvoiceStatus) {
    super(`La cuenta está ${status} y no admite pagos.`);
  }
}

// Códigos propuestos por el orquestador, pendientes de registrar en el contrato.
export class InvoiceNotFoundError extends BillingError {
  readonly code = 'INVOICE_NOT_FOUND';

  constructor(message = 'La cuenta de cobro no existe.') {
    super(message);
  }
}

export class ReceiptNotFoundError extends BillingError {
  readonly code = 'RECEIPT_NOT_FOUND';

  constructor(message = 'El comprobante no existe.') {
    super(message);
  }
}

// Transición que el dominio no define: es un fallo de programación, no de usuario.
export class InvalidStatusTransitionError extends BillingError {
  readonly code = 'INTERNAL_ERROR';

  constructor(
    readonly from: InvoiceStatus,
    readonly to: InvoiceStatus,
  ) {
    super(`Transición de estado no permitida: ${from} → ${to}.`);
  }
}
