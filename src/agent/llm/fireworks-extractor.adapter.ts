import { Logger } from '@nestjs/common';
import OpenAI, {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
} from 'openai';
import type {
  ChatCompletion,
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionMessageParam,
} from 'openai/resources/chat/completions';
import { z } from 'zod';
import { CircuitBreaker } from './circuit-breaker';
import {
  EXTRACTION_SYSTEM_PROMPT,
  PROMPT_VERSION,
  buildRepairMessage,
} from './extraction.prompt';
import {
  EXTRACTION_JSON_SCHEMA,
  ExtractionSchema,
  type Extraction,
} from './extraction.schema';
import type { LlmCallRecord, LlmCallRecorder } from './llm-call-record';
import type { ExtractionContext, LlmExtractorPort } from './llm-extractor.port';
import { ExtractionFailedError, LlmUnavailableError } from './llm.errors';

// Único archivo que conoce a Fireworks (contrato, sección 2.2). Fireworks
// expone una API compatible con OpenAI, por eso se usa el SDK `openai`.

export const FIREWORKS_BASE_URL = 'https://api.fireworks.ai/inference/v1';

// Llamada original + un reintento de reparación (contrato, sección 6.4).
const MAX_ATTEMPTS = 2;
// Tope a la espera que pide un 429, para no colgar la solicitud del supervisor.
const MAX_RETRY_AFTER_MS = 5_000;

// Lo único que el adaptador necesita del cliente; facilita las pruebas.
export interface ChatCompletionClient {
  create(
    params: ChatCompletionCreateParamsNonStreaming,
  ): Promise<ChatCompletion>;
}

export interface FireworksExtractorOptions {
  model: string;
  maxTokens: number;
  // Esperas antes de cada reintento por red, timeout, 5xx o 429.
  retryDelaysMs?: number[];
  // Corta las llamadas cuando Fireworks está caído. Una sola instancia por
  // adaptador: su estado se comparte entre solicitudes.
  breaker?: CircuitBreaker;
}

// Datos de conexión a Fireworks, tal como salen de la configuración (llm.*).
export interface FireworksConnection {
  apiKey: string;
  baseUrl: string;
  timeoutMs: number;
  model: string;
  maxTokens: number;
}

// Único lugar que construye el cliente del SDK `openai`. Los reintentos los hace
// el adaptador con su propia política (sección 9.2), no el SDK.
export function createFireworksExtractor(
  connection: FireworksConnection,
  recorder?: LlmCallRecorder,
): FireworksExtractorAdapter {
  const client = new OpenAI({
    apiKey: connection.apiKey,
    baseURL: connection.baseUrl,
    timeout: connection.timeoutMs,
    maxRetries: 0,
  });
  return new FireworksExtractorAdapter(
    { create: (params) => client.chat.completions.create(params) },
    { model: connection.model, maxTokens: connection.maxTokens },
    recorder,
  );
}

// La llamada se rechazó sin tocar a Fireworks porque el circuito está abierto.
class CircuitOpenError extends Error {
  constructor() {
    super('Circuito abierto: Fireworks no responde; llamadas suspendidas');
    this.name = 'CircuitOpenError';
  }
}

interface Usage {
  promptTokens: number | null;
  completionTokens: number | null;
}

type ParseResult =
  { success: true; data: Extraction } | { success: false; error: string };

export class FireworksExtractorAdapter implements LlmExtractorPort {
  private readonly logger = new Logger(FireworksExtractorAdapter.name);
  private readonly retryDelaysMs: number[];
  private readonly breaker: CircuitBreaker;

  constructor(
    private readonly client: ChatCompletionClient,
    private readonly options: FireworksExtractorOptions,
    private readonly recorder?: LlmCallRecorder,
    private readonly sleep: (ms: number) => Promise<void> = (ms) =>
      new Promise((resolve) => setTimeout(resolve, ms)),
  ) {
    this.retryDelaysMs = options.retryDelaysMs ?? [500, 1_500];
    this.breaker = options.breaker ?? new CircuitBreaker();
  }

  async extract(
    text: string,
    context: ExtractionContext = {},
  ): Promise<Extraction> {
    const startedAt = Date.now();
    const usage: Usage = { promptTokens: null, completionTokens: null };
    const messages: ChatCompletionMessageParam[] = [
      { role: 'system', content: EXTRACTION_SYSTEM_PROMPT },
      { role: 'user', content: text },
    ];
    let rawOutput: string | null = null;

    const record = (
      fields: Pick<LlmCallRecord, 'parsedOk' | 'attempts' | 'error'>,
    ) =>
      this.record({
        requestId: context.requestId ?? null,
        promptVersion: PROMPT_VERSION,
        model: this.options.model,
        inputText: text,
        rawOutput,
        ...usage,
        latencyMs: Date.now() - startedAt,
        ...fields,
      });

    let lastError = '';
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        rawOutput = await this.completeGuarded(messages, usage);
      } catch (error) {
        const unavailable = toUnavailableError(error);
        await record({
          parsedOk: false,
          attempts: attempt,
          error: describeError(error),
        });
        throw unavailable;
      }

      const parsed = parseExtraction(rawOutput);
      if (parsed.success) {
        await record({ parsedOk: true, attempts: attempt, error: null });
        return parsed.data;
      }

      lastError = parsed.error;
      messages.push(
        { role: 'assistant', content: rawOutput },
        { role: 'user', content: buildRepairMessage(parsed.error) },
      );
    }

    await record({ parsedOk: false, attempts: MAX_ATTEMPTS, error: lastError });
    throw new ExtractionFailedError();
  }

  // Pasa por el circuito: si Fireworks lleva varias solicitudes seguidas sin
  // responder, falla de inmediato en vez de esperar timeouts y reintentos.
  private async completeGuarded(
    messages: ChatCompletionMessageParam[],
    usage: Usage,
  ): Promise<string> {
    if (!this.breaker.canAttempt()) throw new CircuitOpenError();
    try {
      const output = await this.completeWithRetry(messages, usage);
      this.breaker.recordSuccess();
      return output;
    } catch (error) {
      // Solo la indisponibilidad del proveedor cuenta; un 401 o un 400 no.
      if (isRetryable(error)) this.breaker.recordFailure();
      else this.breaker.release();
      throw error;
    }
  }

  private async completeWithRetry(
    messages: ChatCompletionMessageParam[],
    usage: Usage,
  ): Promise<string> {
    for (let retry = 0; ; retry++) {
      try {
        const completion = await this.client.create({
          model: this.options.model,
          messages,
          temperature: 0,
          max_tokens: this.options.maxTokens,
          reasoning_effort: 'low',
          response_format: {
            type: 'json_schema',
            json_schema: {
              name: 'extraction',
              schema: EXTRACTION_JSON_SCHEMA as Record<string, unknown>,
            },
          },
        });
        addUsage(usage, completion);
        return completion.choices[0]?.message?.content ?? '';
      } catch (error) {
        if (!isRetryable(error) || retry >= this.retryDelaysMs.length) {
          throw error;
        }
        await this.sleep(retryDelay(error, this.retryDelaysMs[retry]));
      }
    }
  }

  // Un fallo al auditar no debe tumbar la extracción.
  private async record(call: LlmCallRecord): Promise<void> {
    if (!this.recorder) return;
    try {
      await this.recorder.record(call);
    } catch (error) {
      this.logger.warn(
        `No se pudo registrar la llamada al modelo (request_id=${call.requestId}): ${describeError(error)}`,
      );
    }
  }
}

function parseExtraction(rawOutput: string): ParseResult {
  let json: unknown;
  try {
    json = JSON.parse(rawOutput);
  } catch {
    return { success: false, error: 'La respuesta no es JSON válido.' };
  }
  const result = ExtractionSchema.safeParse(json);
  return result.success
    ? { success: true, data: result.data }
    : { success: false, error: z.prettifyError(result.error) };
}

function addUsage(usage: Usage, completion: ChatCompletion): void {
  if (!completion.usage) return;
  usage.promptTokens =
    (usage.promptTokens ?? 0) + completion.usage.prompt_tokens;
  usage.completionTokens =
    (usage.completionTokens ?? 0) + completion.usage.completion_tokens;
}

// Red, timeout, 429 y 5xx se reintentan; 4xx restantes (clave inválida,
// petición mal formada) fallarían igual en el siguiente intento.
function isRetryable(error: unknown): boolean {
  if (error instanceof APIConnectionError) return true;
  if (error instanceof APIError && typeof error.status === 'number') {
    return error.status === 429 || error.status >= 500;
  }
  return false;
}

// Respeta el encabezado de espera del 429 si es mayor que la espera propia.
function retryDelay(error: unknown, defaultMs: number): number {
  if (!(error instanceof APIError) || error.status !== 429) return defaultMs;
  const retryAfterMs = Number(error.headers?.get('retry-after-ms'));
  const retryAfterSeconds = Number(error.headers?.get('retry-after'));
  const requestedMs =
    retryAfterMs > 0
      ? retryAfterMs
      : retryAfterSeconds > 0
        ? retryAfterSeconds * 1_000
        : 0;
  return Math.min(Math.max(defaultMs, requestedMs), MAX_RETRY_AFTER_MS);
}

function toUnavailableError(error: unknown): LlmUnavailableError {
  if (error instanceof CircuitOpenError) {
    return new LlmUnavailableError(error.message, false, { cause: error });
  }
  if (error instanceof APIConnectionTimeoutError) {
    return new LlmUnavailableError('El modelo no respondió a tiempo', true, {
      cause: error,
    });
  }
  return new LlmUnavailableError('El modelo no está disponible', false, {
    cause: error,
  });
}

function describeError(error: unknown): string {
  if (error instanceof APIError) {
    return `${error.status ?? 'sin respuesta'}: ${error.message}`;
  }
  return error instanceof Error ? error.message : String(error);
}
