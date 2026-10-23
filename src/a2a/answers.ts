import type { InvoiceResultData } from '../billing/dto/invoice-result.dto';

// Texto de respuesta para el chatbot de otro negocio. Ese bot muestra al cliente
// el campo `answer` tal cual, así que debe traer los números importantes (total,
// comprobante) y no solo "listo". Todo monto sale de los textos decimales que ya
// calculó el código; aquí solo se les da formato, sin pasar por number.

// "124950.00" -> "$124.950"; "1234.50" -> "$1.234,50".
export function formatCop(amount: string): string {
  const [integer, decimals = '00'] = amount.split('.');
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return decimals === '00' || decimals === '0'
    ? `$${grouped}`
    : `$${grouped},${decimals.padEnd(2, '0')}`;
}

const METHOD_LABELS = {
  cash: 'en efectivo',
  card: 'con tarjeta',
  transfer: 'por transferencia',
} as const;

export function describeInvoice(
  message: string,
  data: InvoiceResultData,
): string {
  const parts = [message];
  parts.push(
    `Cliente ${data.customer.full_name} (${data.customer.document_number}).`,
  );
  parts.push(
    `Total ${formatCop(data.total)} (subtotal ${formatCop(data.subtotal)} + impuesto ${formatCop(data.tax_amount)}).`,
  );
  if (data.payment) {
    parts.push(
      `Pago ${METHOD_LABELS[data.payment.method]} por ${formatCop(data.payment.amount)}.`,
    );
  }
  if (data.receipt) {
    parts.push(`Comprobante N.º ${data.receipt.receipt_number}.`);
  }
  parts.push(`Cuenta ${data.invoice_id}.`);
  return parts.join(' ');
}

export function isInvoiceData(data: unknown): data is InvoiceResultData {
  return (
    typeof data === 'object' &&
    data !== null &&
    'invoice_id' in data &&
    'total' in data &&
    'customer' in data
  );
}
