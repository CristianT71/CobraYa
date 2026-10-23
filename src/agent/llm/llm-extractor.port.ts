import type { Extraction } from './extraction.schema';

// Token de inyección: el orquestador depende del puerto, nunca del adaptador.
export const LLM_EXTRACTOR = Symbol('LLM_EXTRACTOR');

export interface ExtractionContext {
  // Correlaciona la llamada con su fila en llm_call_logs.
  requestId?: string;
}

export interface LlmExtractorPort {
  /**
   * Convierte texto libre en una Extraction ya validada contra el esquema.
   *
   * @throws ExtractionFailedError si la salida no valida tras el reintento de reparación.
   * @throws LlmUnavailableError si el modelo no responde (timeout, red, 5xx, 429).
   */
  extract(text: string, context?: ExtractionContext): Promise<Extraction>;
}
