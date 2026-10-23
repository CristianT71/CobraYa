const MASK = '****';

// Número precedido por una palabra que lo identifica como documento,
// aunque venga con puntos, espacios o guiones ("C.C. 1.032.456.789", "NIT 900123456-7").
const LABELED_DOCUMENT =
  /(\b(?:c[eé]dula|nit|documento|doc|c\.?\s?[ce])\b\.?[^\d\n]{0,15})(\d[\d.\s-]*\d)/gi;

// Cualquier secuencia de 6 o más dígitos seguidos. Puede tapar algún monto
// escrito sin puntos ("350000"); se prefiere enmascarar de más que filtrar una cédula.
const LONG_DIGIT_RUN = /\b\d{6,}\b/g;

const SECRET_KEYS = new Set([
  'x-api-key',
  'authorization',
  'apikey',
  'api_key',
  'serviceapikey',
  'service_api_key',
  'fireworks_api_key',
  'password',
]);

const DOCUMENT_KEYS = new Set(['document_number', 'documentnumber']);

/** "1032456789" -> "****6789". Conserva solo los últimos 4 dígitos. */
export function maskDocument(
  value: string | number | null | undefined,
): string {
  if (value === null || value === undefined) return MASK;
  const digits = String(value).replace(/\D/g, '');
  return MASK + digits.slice(-4);
}

/** Enmascara las cédulas y NIT que aparezcan dentro de un texto libre. */
export function maskDocumentsInText(text: string): string {
  return text
    .replace(
      LABELED_DOCUMENT,
      (_m, label: string, doc: string) => label + maskDocument(doc),
    )
    .replace(LONG_DIGIT_RUN, (doc) => maskDocument(doc));
}

/**
 * Copia profunda de un valor apta para logs: enmascara documentos en textos,
 * enmascara campos `document_number` y oculta claves y secretos.
 */
export function sanitizeForLog<T>(value: T, depth = 0): T {
  if (depth > 8) return value;
  if (typeof value === 'string') return maskDocumentsInText(value) as T;
  if (Array.isArray(value)) {
    return value.map((v) => sanitizeForLog(v, depth + 1)) as T;
  }
  if (value instanceof Error) {
    const copy = new Error(maskDocumentsInText(value.message));
    copy.name = value.name;
    copy.stack = value.stack && maskDocumentsInText(value.stack);
    return copy as T;
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value)) {
      const k = key.toLowerCase();
      if (SECRET_KEYS.has(k)) out[key] = '[REDACTED]';
      else if (
        DOCUMENT_KEYS.has(k) &&
        (typeof v === 'string' || typeof v === 'number')
      )
        out[key] = maskDocument(v);
      else out[key] = sanitizeForLog(v, depth + 1);
    }
    return out as T;
  }
  return value;
}
