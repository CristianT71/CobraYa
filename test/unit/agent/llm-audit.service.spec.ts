import type { Repository } from 'typeorm';
import {
  LlmAuditService,
  NO_REQUEST_ID,
} from '../../../src/agent/llm/llm-audit.service';
import type { LlmCallRecord } from '../../../src/agent/llm/llm-call-record';
import type { LlmCallLog } from '../../../src/agent/llm/llm-call-log.entity';
import {
  maskDigits,
  maskLlmOutput,
  maskLlmText,
} from '../../../src/agent/llm/mask-llm-text';
import { MOCK_EXTRACTIONS } from '../../../src/agent/llm/mock-extractor';

const RAW_OUTPUT = JSON.stringify(MOCK_EXTRACTIONS.completeInvoice);

describe('maskDigits', () => {
  it.each([
    ['1032456789', '****6789'],
    ['1.032.456.789', '****6789'],
    ['123', '****'],
  ])('%s -> %s', (input, expected) => {
    expect(maskDigits(input)).toBe(expected);
  });
});

describe('maskLlmText', () => {
  it.each([
    'Cóbrale a la cédula 1032456789 un cambio de aceite',
    'cobrale a la cedula 1.032.456.789 un filtro',
    'Factura para el NIT 900123456: 2 llantas',
    'CC: 1032456789, pagó en efectivo',
    'documento número 1032456789',
  ])('enmascara el documento anunciado en: %s', (text) => {
    const masked = maskLlmText(text, null);
    expect(masked).toMatch(/\*{4}\d{4}/);
    expect(masked.replace(/\D/g, '')).not.toMatch(/\d{6,}/);
  });

  it('enmascara el número extraído aunque el texto no diga "cédula"', () => {
    const masked = maskLlmText(
      'cóbrale a 1032456789 un cambio de aceite de 80.000',
      RAW_OUTPUT,
    );
    expect(masked).toBe('cóbrale a ****6789 un cambio de aceite de 80.000');
  });

  it('no toca los montos', () => {
    const text = 'un cambio de aceite de 80.000 y un filtro de 25.000';
    expect(maskLlmText(text, RAW_OUTPUT)).toBe(text);
  });
});

describe('maskLlmOutput', () => {
  it('enmascara document_number en la salida del modelo', () => {
    const masked = maskLlmOutput(RAW_OUTPUT);
    expect(masked).toContain('"document_number":"****6789"');
    expect(masked).not.toContain('1032456789');
  });

  it('enmascara también una salida que no es JSON válido', () => {
    expect(maskLlmOutput('{"document_number": "1032456789", ')).toBe(
      '{"document_number": "****6789", ',
    );
  });

  it('deja null y valores vacíos como están', () => {
    expect(maskLlmOutput(null)).toBeNull();
    expect(maskLlmOutput('{"document_number":null}')).toBe(
      '{"document_number":null}',
    );
  });
});

describe('LlmAuditService', () => {
  const call: LlmCallRecord = {
    requestId: 'sup-20261021-0001',
    promptVersion: '1.0.0',
    model: 'accounts/fireworks/models/gpt-oss-120b',
    inputText: 'Cóbrale a la cédula 1032456789 un cambio de aceite de 80.000',
    rawOutput: RAW_OUTPUT,
    parsedOk: true,
    attempts: 1,
    promptTokens: 100,
    completionTokens: 50,
    latencyMs: 320,
    error: null,
  };

  function setup() {
    const insert = jest.fn().mockResolvedValue(undefined);
    const repository = { insert } as unknown as Repository<LlmCallLog>;
    return { service: new LlmAuditService(repository), insert };
  }

  it('guarda una fila con las cédulas enmascaradas', async () => {
    const { service, insert } = setup();
    await service.record(call);

    expect(insert).toHaveBeenCalledTimes(1);
    const [row] = insert.mock.calls[0] as [Partial<LlmCallLog>];
    expect(row).toMatchObject({
      requestId: 'sup-20261021-0001',
      promptVersion: '1.0.0',
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
    expect(JSON.stringify(row)).not.toContain('1032456789');
  });

  it('guarda un request_id de respaldo si la llamada no trae contexto', async () => {
    const { service, insert } = setup();
    await service.record({ ...call, requestId: null });

    const [row] = insert.mock.calls[0] as [Partial<LlmCallLog>];
    expect(row.requestId).toBe(NO_REQUEST_ID);
  });

  it('recorta el request_id a la longitud de la columna', async () => {
    const { service, insert } = setup();
    await service.record({ ...call, requestId: 'x'.repeat(100) });

    const [row] = insert.mock.calls[0] as [Partial<LlmCallLog>];
    expect(row.requestId).toHaveLength(64);
  });
});
