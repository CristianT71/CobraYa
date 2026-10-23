// Enmascarado de cédulas en el texto que entra y sale del modelo, para que
// llm_call_logs nunca guarde un documento completo (contrato, sección 10.1).
// A diferencia de common/utils/mask-document.util.ts, que enmascara un número
// ya conocido, aquí hay que encontrarlo dentro de texto libre o de JSON.

// "1032456789" -> "****6789".
export function maskDigits(value: string): string {
  const digits = value.replace(/\D/g, '');
  return `****${digits.length > 4 ? digits.slice(-4) : ''}`;
}

// Documento junto a la palabra que lo anuncia: "cédula 1.032.456.789",
// "NIT: 900123456-1", "cc 1032456789". Exige 6+ dígitos para no tocar montos
// cortos como "2 llantas".
const ANCHORED_DOCUMENT =
  /\b(c[ée]dula|cc|c\.c\.|nit|ce|documento|doc\.?)(\s*(?:n[°ºo.]*|n[úu]mero|#)?\s*[:=]?\s*)(\d[\d.\s-]{4,}\d)/gi;

// "document_number": "1032456789" en la salida del modelo.
const DOCUMENT_NUMBER_FIELD = /("document_number"\s*:\s*")([^"]*)(")/g;

// Números de documento que el modelo extrajo, para enmascararlos también
// donde el texto los traiga sin palabra clave ("cóbrale a 1032456789").
function extractedDocumentNumbers(rawOutput: string | null): string[] {
  if (!rawOutput) return [];
  return [...rawOutput.matchAll(DOCUMENT_NUMBER_FIELD)]
    .map((match) => match[2].replace(/\D/g, ''))
    .filter((digits) => digits.length >= 5);
}

// Reemplaza el número aunque en el texto venga con puntos o espacios.
function maskKnownNumber(text: string, digits: string): string {
  const pattern = new RegExp(
    `(?<!\\d)${digits.split('').join('[.\\s-]?')}(?!\\d)`,
    'g',
  );
  return text.replace(pattern, (match) => maskDigits(match));
}

export function maskLlmText(text: string, rawOutput: string | null): string {
  let masked = text.replace(
    ANCHORED_DOCUMENT,
    (_match, label: string, separator: string, number: string) =>
      `${label}${separator}${maskDigits(number)}`,
  );
  for (const digits of extractedDocumentNumbers(rawOutput)) {
    masked = maskKnownNumber(masked, digits);
  }
  return masked;
}

export function maskLlmOutput(rawOutput: string | null): string | null {
  if (rawOutput === null) return null;
  return rawOutput.replace(
    DOCUMENT_NUMBER_FIELD,
    (_match, open: string, value: string, close: string) =>
      `${open}${value ? maskDigits(value) : value}${close}`,
  );
}
