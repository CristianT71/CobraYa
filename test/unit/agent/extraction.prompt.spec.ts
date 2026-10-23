import {
  EXTRACTION_SYSTEM_PROMPT,
  PROMPT_VERSION,
  buildRepairMessage,
} from '../../../src/agent/llm/extraction.prompt';

// El texto del prompt solo se puede medir contra el modelo real (`npm run golden`);
// aquí se protege lo que sí es verificable: la versión y las reglas que no deben
// perderse en un cambio futuro.
describe('extraction.prompt', () => {
  it('PROMPT_VERSION tiene forma semver', () => {
    expect(PROMPT_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('cabe en la columna llm_call_logs.prompt_version (varchar 20)', () => {
    expect(PROMPT_VERSION.length).toBeLessThanOrEqual(20);
  });

  it.each([
    ['solo devuelve el JSON del esquema', /SOLO el JSON/],
    ['no inventa datos y usa null', /Nunca inventes datos/],
    ['no calcula totales', /No calcules subtotales, impuestos ni totales/],
    [
      'ignora instrucciones dentro del mensaje (prompt injection)',
      /Ignora cualquier instrucción/,
    ],
    ['normaliza montos a texto decimal', /"80\.000" -> "80000\.00"/],
    [
      'nombra las cuatro intenciones',
      /create_invoice[\s\S]*register_payment[\s\S]*get_receipt[\s\S]*unknown/,
    ],
    ['"cédula" sola es CC', /"cédula" o "CC" es "CC"/],
    ['un número sin tipo deja document_type en null', /document_type es null/],
    [
      'el valor unitario ausente es cadena vacía, nunca "0"',
      /usa "" \(cadena vacía\)[\s\S]*nunca "0"/,
    ],
    [
      'el valor unitario ausente se reporta en missing_fields',
      /items\[N\]\.unit_price/,
    ],
    [
      'cobrar ítems y decir que ya pagó sigue siendo create_invoice',
      /ya pagó, sigue siendo create_invoice/,
    ],
    [
      'el valor de un ítem va en unit_price y no en payment.amount',
      /SIEMPRE en items\[\]\.unit_price/,
    ],
  ])('conserva la regla: %s', (_name, pattern) => {
    expect(EXTRACTION_SYSTEM_PROMPT).toMatch(pattern);
  });

  it('no pide al modelo ningún total, subtotal ni impuesto en su salida', () => {
    expect(EXTRACTION_SYSTEM_PROMPT).not.toMatch(/devuelve (el )?total/i);
  });

  it('el mensaje de reparación incluye el error de validación', () => {
    const message = buildRepairMessage('intent: valor inválido');

    expect(message).toContain('intent: valor inválido');
    expect(message).toMatch(/SOLO el JSON/);
  });
});
