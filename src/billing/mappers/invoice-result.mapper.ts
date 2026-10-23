import { maskDocument } from '../../common/utils/mask-document.util';
import type { InvoiceResultData } from '../dto/invoice-result.dto';
import type { Invoice } from '../entities/invoice.entity';

// Convierte una cuenta guardada (con customer, items, payments y receipt cargados)
// a la forma InvoiceResultData. Los montos siguen siendo texto decimal.
export function toInvoiceResultData(invoice: Invoice): InvoiceResultData {
  const payment = invoice.payments?.[0] ?? null;
  const receipt = invoice.receipt ?? null;

  return {
    invoice_id: invoice.id,
    customer: {
      document_type: invoice.customer.documentType,
      document_number: maskDocument(invoice.customer.documentNumber),
      full_name: invoice.customer.fullName,
    },
    items: invoice.items.map((item) => ({
      description: item.description,
      quantity: Number(item.quantity),
      unit_price: item.unitPrice,
      line_total: item.lineTotal,
    })),
    subtotal: invoice.subtotal,
    tax_rate: invoice.taxRate,
    tax_amount: invoice.taxAmount,
    total: invoice.total,
    payment: payment
      ? {
          method: payment.method,
          amount: payment.amount,
          status: payment.status,
        }
      : null,
    receipt: receipt
      ? {
          receipt_number: receipt.receiptNumber,
          issued_at: receipt.issuedAt.toISOString(),
        }
      : null,
  };
}
