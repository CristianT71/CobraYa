import {
  ExtractionSchema,
  EXTRACTION_JSON_SCHEMA,
} from '../../../src/agent/llm/extraction.schema';
import {
  ExtractionFailedError,
  LlmUnavailableError,
} from '../../../src/agent/llm/llm.errors';
import {
  MOCK_EXTRACTIONS,
  MockExtractor,
} from '../../../src/agent/llm/mock-extractor';

describe('ExtractionSchema', () => {
  it.each(Object.entries(MOCK_EXTRACTIONS))(
    'acepta la extracción fija %s',
    (_name, extraction) => {
      expect(ExtractionSchema.safeParse(extraction).success).toBe(true);
    },
  );

  it('rechaza campos no declarados, como un total inventado', () => {
    const result = ExtractionSchema.safeParse({
      ...MOCK_EXTRACTIONS.completeInvoice,
      total: '124950.00',
    });
    expect(result.success).toBe(false);
  });

  it('rechaza una intención fuera del catálogo', () => {
    const result = ExtractionSchema.safeParse({
      ...MOCK_EXTRACTIONS.completeInvoice,
      intent: 'delete_invoice',
    });
    expect(result.success).toBe(false);
  });

  it('genera un JSON Schema estricto', () => {
    expect(EXTRACTION_JSON_SCHEMA).toMatchObject({
      type: 'object',
      additionalProperties: false,
    });
    expect(EXTRACTION_JSON_SCHEMA.required).toEqual(
      expect.arrayContaining(['intent', 'customer', 'items', 'payment']),
    );
  });
});

describe('MockExtractor', () => {
  it('devuelve por defecto el ejemplo de la sección 7.3', async () => {
    const extractor = new MockExtractor();
    await expect(extractor.extract('texto')).resolves.toEqual(
      MOCK_EXTRACTIONS.completeInvoice,
    );
  });

  it('registra el texto y el contexto de cada llamada', async () => {
    const extractor = new MockExtractor();
    await extractor.extract('hola', { requestId: 'sup-1' });
    expect(extractor.calls).toEqual([
      { text: 'hola', context: { requestId: 'sup-1' } },
    ]);
  });

  it('devuelve una copia, para que el llamador no altere la extracción fija', async () => {
    const extractor = new MockExtractor();
    const first = await extractor.extract('a');
    first.items.pop();
    const second = await extractor.extract('b');
    expect(second.items).toHaveLength(2);
  });

  it.each([new ExtractionFailedError(), new LlmUnavailableError()])(
    'lanza el error configurado: %s',
    async (error) => {
      const extractor = new MockExtractor();
      extractor.respondWith(error);
      await expect(extractor.extract('x')).rejects.toBe(error);
    },
  );
});
