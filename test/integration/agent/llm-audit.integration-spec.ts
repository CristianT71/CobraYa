import { DataSource } from 'typeorm';
import {
  LlmAuditService,
  NO_REQUEST_ID,
} from '../../../src/agent/llm/llm-audit.service';
import { LlmCallLog } from '../../../src/agent/llm/llm-call-log.entity';
import type { LlmCallRecord } from '../../../src/agent/llm/llm-call-record';

// La entidad LlmCallLog contra la tabla real que crea la migración inicial.
// Si E2E_DATABASE_URL no está definida, la suite se omite.

const DATABASE_URL = process.env.E2E_DATABASE_URL;
const describeWithDb = DATABASE_URL ? describe : describe.skip;

describeWithDb('LlmAuditService contra llm_call_logs (PostgreSQL)', () => {
  let dataSource: DataSource;
  let service: LlmAuditService;

  const call: LlmCallRecord = {
    requestId: 'sup-20261021-0001',
    promptVersion: '1.0.0',
    model: 'accounts/fireworks/models/gpt-oss-120b',
    inputText: 'Cóbrale a la cédula 1032456789 un cambio de aceite de 80.000',
    rawOutput: '{"customer":{"document_number":"1032456789"}}',
    parsedOk: true,
    attempts: 1,
    promptTokens: 100,
    completionTokens: 50,
    latencyMs: 320,
    error: null,
  };

  const rows = () =>
    dataSource.getRepository(LlmCallLog).find({ order: { createdAt: 'ASC' } });

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: DATABASE_URL,
      entities: [LlmCallLog],
      synchronize: false,
    });
    await dataSource.initialize();
    service = new LlmAuditService(dataSource.getRepository(LlmCallLog));
  });

  afterAll(async () => {
    await dataSource?.destroy();
  });

  beforeEach(async () => {
    await dataSource.query('TRUNCATE llm_call_logs');
  });

  it('guarda una llamada exitosa con la cédula enmascarada en entrada y salida', async () => {
    await service.record(call);

    const [row] = await rows();
    expect(row).toMatchObject({
      requestId: 'sup-20261021-0001',
      promptVersion: '1.0.0',
      model: 'accounts/fireworks/models/gpt-oss-120b',
      parsedOk: true,
      attempts: 1,
      promptTokens: 100,
      completionTokens: 50,
      latencyMs: 320,
      error: null,
    });
    expect(row.inputText).toBe(
      'Cóbrale a la cédula ****6789 un cambio de aceite de 80.000',
    );
    expect(row.rawOutput).toContain('****6789');
    expect(JSON.stringify(row)).not.toContain('1032456789');
    expect(row.createdAt).toBeInstanceOf(Date);
  });

  it('guarda una llamada fallida con parsed_ok = false y su error', async () => {
    await service.record({
      ...call,
      rawOutput: null,
      parsedOk: false,
      attempts: 2,
      promptTokens: null,
      completionTokens: null,
      error: '502: Bad Gateway',
    });

    const [row] = await rows();
    expect(row).toMatchObject({
      parsedOk: false,
      attempts: 2,
      rawOutput: null,
      promptTokens: null,
      completionTokens: null,
      error: '502: Bad Gateway',
    });
  });

  it('una llamada sin request_id no viola la restricción NOT NULL', async () => {
    await service.record({ ...call, requestId: null });

    const [row] = await rows();
    expect(row.requestId).toBe(NO_REQUEST_ID);
  });

  it('la restricción de la migración rechaza intentos distintos de 1 o 2', async () => {
    await expect(service.record({ ...call, attempts: 3 })).rejects.toThrow(
      /ck_llm_call_logs_attempts/,
    );
  });
});
