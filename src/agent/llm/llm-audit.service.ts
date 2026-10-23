import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import type { LlmCallRecord, LlmCallRecorder } from './llm-call-record';
import { LlmCallLog } from './llm-call-log.entity';
import { maskLlmOutput, maskLlmText } from './mask-llm-text';

// Guarda cada llamada al modelo en llm_call_logs, incluso si falló
// (contrato, sección 10.3).
@Injectable()
export class LlmAuditService implements LlmCallRecorder {
  constructor(
    @InjectRepository(LlmCallLog)
    private readonly logs: Repository<LlmCallLog>,
  ) {}

  async record(call: LlmCallRecord): Promise<void> {
    await this.logs.insert({
      // Recorta a lo que admiten las columnas para que el insert no falle.
      requestId: call.requestId?.slice(0, 64) ?? null,
      promptVersion: call.promptVersion.slice(0, 20),
      model: call.model.slice(0, 80),
      inputText: maskLlmText(call.inputText, call.rawOutput),
      rawOutput: maskLlmOutput(call.rawOutput),
      parsedOk: call.parsedOk,
      attempts: call.attempts,
      promptTokens: call.promptTokens,
      completionTokens: call.completionTokens,
      latencyMs: call.latencyMs,
      error: call.error,
    });
  }
}
