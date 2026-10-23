import type { DocumentType } from '../customers/customer.entity';
import type { PaymentMethod } from '../billing/entities/payment.entity';

// Todo lo que lleva el comprobante impreso. Los montos son texto decimal.
export interface ReceiptDocument {
  receiptNumber: number;
  /** Primeros caracteres del id de la cuenta, para citarla. */
  accountRef: string;
  /** Referencia del pedido en el negocio que cobró (external_ref), si la mandó. */
  externalRef: string | null;
  issuedAt: Date;
  issuerName: string;
  customer: {
    fullName: string;
    documentType: DocumentType;
    documentNumber: string;
  };
  items: Array<{
    description: string;
    quantity: number;
    unitPrice: string;
    lineTotal: string;
  }>;
  subtotal: string;
  taxRate: string;
  taxAmount: string;
  total: string;
  payment: { method: PaymentMethod; amount: string } | null;
}
