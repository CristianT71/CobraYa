// Formato de montos y fechas. Los montos llegan del servicio como texto decimal
// ("124950.00") y se formatean con operaciones de texto: nunca pasan por number.

// "124950.00" -> "$124.950"; "1234.50" -> "$1.234,50".
export function formatCop(amount: string): string {
  const [integer = '0', decimals = '00'] = amount.split('.');
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return decimals === '00' || decimals === '0'
    ? `$${grouped}`
    : `$${grouped},${decimals.padEnd(2, '0')}`;
}

const dateFormatter = new Intl.DateTimeFormat('es-CO', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'America/Bogota',
});

export function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : dateFormatter.format(date);
}

export const METHOD_LABELS: Record<string, string> = {
  cash: 'Efectivo',
  card: 'Tarjeta',
  transfer: 'Transferencia',
};

// Clave de idempotencia para una operación de prueba desde el navegador.
export function newIdempotencyKey(): string {
  const random =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `web-${random}`;
}
