import type { InvoiceResultData } from '../dto/agent-response.dto';
import type { PaymentMethod } from '../llm/extraction.schema';

// Lo que el orquestador necesita de billing (Jheison). Los comandos siguen la
// forma propuesta para CreateInvoiceCommand y RegisterPaymentCommand; si la
// versión final cambia, solo se ajusta el mapper y este archivo.
//
// Los errores de negocio se lanzan con una propiedad `code` del catálogo de
// la sección 9.1 (CUSTOMER_NOT_FOUND, TOTAL_EXCEEDS_LIMIT, ...).

export const BILLING_GATEWAY = Symbol('BILLING_GATEWAY');

export interface CreateInvoiceCommand {
  customerId: string;
  // Cantidades y montos como texto decimal: nunca number flotante.
  items: Array<{ description: string; quantity: string; unitPrice: string }>;
  // Con pago, la cuenta se crea y se paga en la misma transacción (RN-05).
  payment: { method: PaymentMethod; amount: string | null } | null;
  idempotencyKey: string;
  source: 'agent' | 'direct';
  externalRef: string | null;
}

export interface RegisterPaymentCommand {
  invoiceId: string;
  method: PaymentMethod;
  // Vacío → el código usa el total (RN-06).
  amount: string | null;
  idempotencyKey: string;
}

export type GetReceiptQuery = { receiptNumber: number } | { invoiceId: string };

export interface BillingGateway {
  createInvoice(command: CreateInvoiceCommand): Promise<InvoiceResultData>;
  registerPayment(command: RegisterPaymentCommand): Promise<InvoiceResultData>;
  getReceipt(query: GetReceiptQuery): Promise<InvoiceResultData>;
  // Para RN-08: pagar sin invoice_id exige exactamente una cuenta PENDING.
  findPendingInvoiceIds(customerId: string): Promise<string[]>;
}
