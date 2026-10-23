import type { InvoiceResultData } from '../dto/invoice-result.dto';

// Lo que el controlador directo y el módulo agent necesitan de los casos de uso
// de billing (application/). Los comandos son el contrato entre los módulos.

export const CREATE_INVOICE_USE_CASE = Symbol('CREATE_INVOICE_USE_CASE');
export const REGISTER_PAYMENT_USE_CASE = Symbol('REGISTER_PAYMENT_USE_CASE');
export const GET_RECEIPT_USE_CASE = Symbol('GET_RECEIPT_USE_CASE');

export interface CreateInvoiceCommand {
  customerId: string;
  // Cantidades y montos como texto decimal: nunca number flotante.
  items: Array<{ description: string; quantity: string; unitPrice: string }>;
  payment: {
    method: 'cash' | 'card' | 'transfer';
    amount: string | null;
  } | null;
  idempotencyKey: string;
  source: 'agent' | 'direct';
  externalRef: string | null;
  // Negocio dueño de la cuenta; sin él (o null) es la plataforma. El cliente debe
  // pertenecer al mismo ámbito.
  partnerId?: string | null;
}

export interface RegisterPaymentCommand {
  invoiceId: string;
  method: 'cash' | 'card' | 'transfer';
  // Vacío: el código usa el total (RN-06).
  amount: string | null;
  idempotencyKey: string;
  // Con negocio, solo puede pagar cuentas de ese negocio (si no, INVOICE_NOT_FOUND).
  // Sin él no hay restricción: es el ámbito del operador (clave de servicio).
  partnerId?: string;
}

// `partnerId` restringe la consulta a un negocio; sin él no hay restricción.
export type GetReceiptQuery = (
  { receiptNumber: number } | { invoiceId: string }
) & { partnerId?: string };

export interface CreateInvoiceUseCasePort {
  execute(command: CreateInvoiceCommand): Promise<InvoiceResultData>;
}

export interface RegisterPaymentUseCasePort {
  execute(command: RegisterPaymentCommand): Promise<InvoiceResultData>;
}

export interface GetReceiptUseCasePort {
  execute(query: GetReceiptQuery): Promise<InvoiceResultData>;
}
