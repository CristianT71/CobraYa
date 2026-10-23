import {
  APIConnectionTimeoutError,
  AuthenticationError,
  InternalServerError,
  RateLimitError,
} from 'openai';
import type {
  ChatCompletion,
  ChatCompletionCreateParamsNonStreaming,
} from 'openai/resources/chat/completions';
import { PROMPT_VERSION } from '../../../src/agent/llm/extraction.prompt';
import { CircuitBreaker } from '../../../src/agent/llm/circuit-breaker';
import {
  type ChatCompletionClient,
  FireworksExtractorAdapter,
} from '../../../src/agent/llm/fireworks-extractor.adapter';
import type {
  LlmCallRecord,
  LlmCallRecorder,
} from '../../../src/agent/llm/llm-call-record';
import {
  ExtractionFailedError,
  LlmUnavailableError,
} from '../../../src/agent/llm/llm.errors';
import { MOCK_EXTRACTIONS } from '../../../src/agent/llm/mock-extractor';

const MODEL = 'accounts/fireworks/models/gpt-oss-120b';
const VALID_JSON = JSON.stringify(MOCK_EXTRACTIONS.completeInvoice);

function completion(content: string): ChatCompletion {
  return {
    id: 'cmpl-1',
    object: 'chat.completion',
    created: 0,
    model: MODEL,
    choices: [
      {
        index: 0,
        finish_reason: 'stop',
        logprobs: null,
        message: { role: 'assistant', content, refusal: null },
      },
    ],
    usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
  };
}

// Cliente falso: cada llamada consume la siguiente respuesta de la cola.
class FakeClient implements ChatCompletionClient {
  readonly requests: ChatCompletionCreateParamsNonStreaming[] = [];

  constructor(private readonly queue: Array<string | Error>) {}

  create(params: ChatCompletionCreateParamsNonStreaming) {
    // Copia los mensajes: el adaptador agrega los de reparación al mismo arreglo.
    this.requests.push({ ...params, messages: [...params.messages] });
    const next = this.queue.shift();
    if (next === undefined) throw new Error('Cola de respuestas vacía');
    if (next instanceof Error) return Promise.reject(next);
    return Promise.resolve(completion(next));
  }
}

class FakeRecorder implements LlmCallRecorder {
  readonly calls: LlmCallRecord[] = [];
  record(call: LlmCallRecord) {
    this.calls.push(call);
    return Promise.resolve();
  }
}

function setup(queue: Array<string | Error>) {
  const client = new FakeClient(queue);
  const recorder = new FakeRecorder();
  const sleeps: number[] = [];
  const adapter = new FireworksExtractorAdapter(
    client,
    { model: MODEL, maxTokens: 1000 },
    recorder,
    (ms) => {
      sleeps.push(ms);
      return Promise.resolve();
    },
  );
  return { adapter, client, recorder, sleeps };
}

describe('FireworksExtractorAdapter', () => {
  it('envía los parámetros de la sección 6.1 del contrato', async () => {
    const { adapter, client } = setup([VALID_JSON]);
    await adapter.extract('Cóbrale a la cédula 1032456789');

    const [request] = client.requests;
    expect(request).toMatchObject({
      model: MODEL,
      temperature: 0,
      max_tokens: 1000,
      reasoning_effort: 'low',
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'extraction' },
      },
    });
    expect(request.tools).toBeUndefined();
    expect(request.messages).toEqual([
      { role: 'system', content: expect.any(String) },
      { role: 'user', content: 'Cóbrale a la cédula 1032456789' },
    ]);
  });

  it('devuelve la extracción validada y la registra con parsed_ok = true', async () => {
    const { adapter, recorder } = setup([VALID_JSON]);

    await expect(
      adapter.extract('texto', { requestId: 'sup-1' }),
    ).resolves.toEqual(MOCK_EXTRACTIONS.completeInvoice);

    expect(recorder.calls).toEqual([
      expect.objectContaining({
        requestId: 'sup-1',
        promptVersion: PROMPT_VERSION,
        model: MODEL,
        inputText: 'texto',
        rawOutput: VALID_JSON,
        parsedOk: true,
        attempts: 1,
        promptTokens: 100,
        completionTokens: 50,
        error: null,
      }),
    ]);
  });

  it('hace un reintento de reparación enviando el error de validación', async () => {
    const invalid = JSON.stringify({ intent: 'create_invoice' });
    const { adapter, client, recorder } = setup([invalid, VALID_JSON]);

    await expect(adapter.extract('texto')).resolves.toEqual(
      MOCK_EXTRACTIONS.completeInvoice,
    );

    expect(client.requests).toHaveLength(2);
    const repairMessages = client.requests[1].messages.slice(2);
    expect(repairMessages).toEqual([
      { role: 'assistant', content: invalid },
      {
        role: 'user',
        content: expect.stringContaining('no cumple el esquema'),
      },
    ]);
    expect(recorder.calls[0]).toMatchObject({
      parsedOk: true,
      attempts: 2,
      promptTokens: 200,
      completionTokens: 100,
    });
  });

  it('con JSON inválido dos veces lanza EXTRACTION_FAILED y registra parsed_ok = false', async () => {
    const { adapter, client, recorder } = setup(['no es json', '{"a":1}']);

    await expect(adapter.extract('texto')).rejects.toBeInstanceOf(
      ExtractionFailedError,
    );

    expect(client.requests).toHaveLength(2);
    expect(recorder.calls).toEqual([
      expect.objectContaining({
        parsedOk: false,
        attempts: 2,
        rawOutput: '{"a":1}',
        error: expect.any(String),
      }),
    ]);
  });

  it('reintenta un 5xx con espera creciente y luego responde', async () => {
    const serverError = new InternalServerError(
      500,
      undefined,
      'boom',
      new Headers(),
    );
    const { adapter, sleeps } = setup([serverError, VALID_JSON]);

    await expect(adapter.extract('texto')).resolves.toBeDefined();
    expect(sleeps).toEqual([500]);
  });

  it('tras dos reintentos por timeout lanza LLM_UNAVAILABLE marcado como timeout', async () => {
    const { adapter, client, recorder, sleeps } = setup([
      new APIConnectionTimeoutError(),
      new APIConnectionTimeoutError(),
      new APIConnectionTimeoutError(),
    ]);

    const error = await adapter.extract('texto').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(LlmUnavailableError);
    expect((error as LlmUnavailableError).timedOut).toBe(true);
    expect(client.requests).toHaveLength(3);
    expect(sleeps).toEqual([500, 1500]);
    expect(recorder.calls).toEqual([
      expect.objectContaining({
        parsedOk: false,
        rawOutput: null,
        error: expect.any(String),
      }),
    ]);
  });

  it('ante un 429 respeta el encabezado retry-after', async () => {
    const rateLimited = new RateLimitError(
      429,
      undefined,
      'rate limit',
      new Headers({ 'retry-after': '2' }),
    );
    const { adapter, sleeps } = setup([rateLimited, VALID_JSON]);

    await adapter.extract('texto');
    expect(sleeps).toEqual([2000]);
  });

  it('no reintenta un 401 y lo reporta como LLM_UNAVAILABLE sin timeout', async () => {
    const unauthorized = new AuthenticationError(
      401,
      undefined,
      'bad key',
      new Headers(),
    );
    const { adapter, client, sleeps } = setup([unauthorized]);

    const error = await adapter.extract('texto').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(LlmUnavailableError);
    expect((error as LlmUnavailableError).timedOut).toBe(false);
    expect(client.requests).toHaveLength(1);
    expect(sleeps).toEqual([]);
  });

  it('si la auditoría falla, la extracción igual se devuelve', async () => {
    const client = new FakeClient([VALID_JSON]);
    const adapter = new FireworksExtractorAdapter(
      client,
      { model: MODEL, maxTokens: 1000 },
      { record: () => Promise.reject(new Error('db caída')) },
    );

    await expect(adapter.extract('texto')).resolves.toEqual(
      MOCK_EXTRACTIONS.completeInvoice,
    );
  });

  describe('circuito contra Fireworks caído', () => {
    const down = () =>
      new InternalServerError(500, undefined, 'boom', new Headers());

    // Cada extract() agotado (1 llamada + 2 reintentos) cuenta como una falla.
    function setupBreaker(queue: Array<string | Error>) {
      let clock = 0;
      const breaker = new CircuitBreaker(
        { failureThreshold: 2, cooldownMs: 1000 },
        () => clock,
      );
      const client = new FakeClient(queue);
      const recorder = new FakeRecorder();
      const adapter = new FireworksExtractorAdapter(
        client,
        { model: MODEL, maxTokens: 1000, breaker },
        recorder,
        () => Promise.resolve(),
      );
      return {
        adapter,
        client,
        recorder,
        advance: (ms: number) => (clock += ms),
      };
    }

    const fails = [down(), down(), down()];

    it('tras varias solicitudes seguidas sin respuesta deja de llamar a Fireworks', async () => {
      const { adapter, client } = setupBreaker([...fails, ...fails]);

      await adapter.extract('uno').catch(() => undefined);
      await adapter.extract('dos').catch(() => undefined);
      expect(client.requests).toHaveLength(6);

      const error = await adapter.extract('tres').catch((e: unknown) => e);

      expect(error).toBeInstanceOf(LlmUnavailableError);
      expect((error as LlmUnavailableError).timedOut).toBe(false);
      expect(client.requests).toHaveLength(6);
    });

    it('registra en la bitácora la llamada rechazada por el circuito', async () => {
      const { adapter, recorder } = setupBreaker([...fails, ...fails]);
      await adapter.extract('uno').catch(() => undefined);
      await adapter.extract('dos').catch(() => undefined);

      await adapter
        .extract('tres', { requestId: 'sup-3' })
        .catch(() => undefined);

      expect(recorder.calls.at(-1)).toMatchObject({
        requestId: 'sup-3',
        parsedOk: false,
        rawOutput: null,
        error: expect.stringContaining('Circuito abierto'),
      });
    });

    it('vencido el enfriamiento prueba con una llamada y, si responde, se recupera', async () => {
      const { adapter, client, advance } = setupBreaker([
        ...fails,
        ...fails,
        VALID_JSON,
        VALID_JSON,
      ]);
      await adapter.extract('uno').catch(() => undefined);
      await adapter.extract('dos').catch(() => undefined);
      await adapter.extract('tres').catch(() => undefined);

      advance(1000);

      await expect(adapter.extract('cuatro')).resolves.toBeDefined();
      await expect(adapter.extract('cinco')).resolves.toBeDefined();
      expect(client.requests).toHaveLength(8);
    });

    it('una salida inválida del modelo no abre el circuito: el proveedor sí respondió', async () => {
      const { adapter } = setupBreaker([
        'no es json',
        'no es json',
        'no es json',
        'no es json',
        VALID_JSON,
      ]);

      await expect(adapter.extract('uno')).rejects.toBeInstanceOf(
        ExtractionFailedError,
      );
      await expect(adapter.extract('dos')).rejects.toBeInstanceOf(
        ExtractionFailedError,
      );
      await expect(adapter.extract('tres')).resolves.toBeDefined();
    });

    it('una clave inválida (401) no abre el circuito', async () => {
      const unauthorized = () =>
        new AuthenticationError(401, undefined, 'bad key', new Headers());
      const { adapter, client } = setupBreaker([
        unauthorized(),
        unauthorized(),
        unauthorized(),
        VALID_JSON,
      ]);

      for (const text of ['uno', 'dos', 'tres']) {
        await adapter.extract(text).catch(() => undefined);
      }

      await expect(adapter.extract('cuatro')).resolves.toBeDefined();
      expect(client.requests).toHaveLength(4);
    });
  });
});
