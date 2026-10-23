// Datos de una llamada al modelo, tal como los produce el adaptador. El
// registrador (LlmAuditService) los guarda en llm_call_logs y es quien
// enmascara las cédulas de input_text y raw_output antes de escribir.

export const LLM_CALL_RECORDER = Symbol('LLM_CALL_RECORDER');

export interface LlmCallRecord {
  requestId: string | null;
  promptVersion: string;
  model: string;
  inputText: string;
  rawOutput: string | null;
  parsedOk: boolean;
  // 1, o 2 con reintento de reparación.
  attempts: number;
  promptTokens: number | null;
  completionTokens: number | null;
  latencyMs: number;
  error: string | null;
}

export interface LlmCallRecorder {
  record(call: LlmCallRecord): Promise<void>;
}
