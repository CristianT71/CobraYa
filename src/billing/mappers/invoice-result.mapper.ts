import type { InvoiceResultData } from '../dto/invoice-result.dto';
import type { Invoice } from '../entities/invoice.entity';

// Mismo formato que mask-document.util.ts (****6789). Cuando se confirme el
// nombre de la utilidad de Alejandro, se puede importar en vez de repetirla.
function maskDocumentNumber(value: string): string {
    return `****${value.slice(-4)}`;
}

// Convierte una cuenta guardada (con customer, items, payments y receipt cargados)
// a la forma InvoiceResultData. Los montos siguen siendo texto decimal.
export function toInvoiceResultData(invoice: Invoice): InvoiceResultData {
    const payment = invoice.payments?.[0] ?? null;
    const receipt = invoice.receipt ?? null;

    return {
        invoice_id: invoice.id,
        customer: {
            document_type: invoice.customer.documentType,
            document_number: maskDocumentNumber(invoice.customer.documentNumber),
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
            ? { method: payment.method, amount: payment.amount, status: payment.status }
            : null,
        receipt: receipt
            ? {
                receipt_number: receipt.receiptNumber,
                issued_at: receipt.issuedAt.toISOString(),
            }
            : null,
    };
}