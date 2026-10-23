// Errores del extractor (contrato, sección 9.1). El orquestador y el filtro
// global los traducen a la respuesta usando `code`.

export class ExtractionFailedError extends Error {
  readonly code = 'EXTRACTION_FAILED';

  constructor(
    message = 'La salida del modelo no cumplió el esquema tras el reintento',
  ) {
    super(message);
    this.name = 'ExtractionFailedError';
  }
}

export class LlmUnavailableError extends Error {
  readonly code = 'LLM_UNAVAILABLE';

  constructor(
    message = 'El modelo no está disponible',
    // true → 504 (timeout); false → 502 (red, 5xx, 429).
    readonly timedOut = false,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'LlmUnavailableError';
  }
}
