import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Extraction } from '../../../src/agent/llm/extraction.schema';
import { MOCK_EXTRACTIONS } from '../../../src/agent/llm/mock-extractor';
import {
  type GoldenCase,
  compareRuns,
  meetsTargets,
  sameAmount,
  scoreCase,
  summarize,
} from '../../golden/golden-scoring';

const dataset: unknown = JSON.parse(
  readFileSync(join(__dirname, '../../golden/golden-dataset.json'), 'utf8'),
);

const CASE: GoldenCase = {
  id: 'g-001',
  text: 'Cóbrale a la cédula 1032456789 un cambio de aceite de 80.000 y un filtro de 25.000, pagó en efectivo',
  expected: {
    intent: 'create_invoice',
    customer: { document_type: 'CC', document_number: '1032456789' },
    items: [
      { description: 'Cambio de aceite', quantity: 1, unit_price: '80000.00' },
      { description: 'Filtro', quantity: 1, unit_price: '25000.00' },
    ],
    payment: { method: 'cash', amount: null },
  },
};

const actual = (overrides: Partial<Extraction> = {}): Extraction => ({
  ...structuredClone(MOCK_EXTRACTIONS.completeInvoice),
  ...overrides,
});

describe('golden-dataset.json', () => {
  const cases = dataset as GoldenCase[];

  it('tiene entre 30 y 50 casos con id único', () => {
    expect(cases.length).toBeGreaterThanOrEqual(30);
    expect(cases.length).toBeLessThanOrEqual(50);
    expect(new Set(cases.map((c) => c.id)).size).toBe(cases.length);
  });

  it.each([
    'montos-puntos',
    'montos-mil',
    'cedula-sin-tipo',
    'items-multiples',
    'pago-sin-metodo',
    'intencion-ambigua',
    'datos-faltantes',
    'inyeccion',
    'ortografia',
  ])('cubre la categoría %s de la sección 11.2', (tag) => {
    expect(cases.some((c) => c.tags?.includes(tag))).toBe(true);
  });

  it('cubre las cuatro intenciones', () => {
    const intents = new Set(cases.map((c) => c.expected.intent));
    expect([...intents].sort()).toEqual([
      'create_invoice',
      'get_receipt',
      'register_payment',
      'unknown',
    ]);
  });
});

describe('sameAmount', () => {
  it.each([
    ['80000', '80000.00', true],
    ['80000.5', '80000.50', true],
    ['80000.00', '80001.00', false],
    ['80.000', '80000.00', false],
    [null, null, true],
    [null, '0', false],
  ] as const)('%s vs %s -> %s', (a, b, expected) => {
    expect(sameAmount(a, b)).toBe(expected);
  });
});

describe('scoreCase', () => {
  it('acierta todo con la extracción esperada, sin importar el orden ni la descripción', () => {
    const score = scoreCase(
      CASE,
      actual({
        items: [
          { description: 'filtro de aceite', quantity: 1, unit_price: '25000' },
          { description: 'aceite', quantity: 1, unit_price: '80000.00' },
        ],
      }),
    );
    expect(score).toMatchObject({
      intent: true,
      customer: true,
      amounts: true,
      paymentMethod: true,
      relatedIds: null,
    });
  });

  it('falla montos si un valor unitario no coincide', () => {
    const score = scoreCase(
      CASE,
      actual({
        items: [
          { description: 'a', quantity: 1, unit_price: '80000.00' },
          { description: 'b', quantity: 1, unit_price: '2500.00' },
        ],
      }),
    );
    expect(score.amounts).toBe(false);
    expect(score.customer).toBe(true);
  });

  it('falla cliente si el tipo de documento no coincide', () => {
    const score = scoreCase(
      CASE,
      actual({
        customer: { document_type: null, document_number: '1032456789' },
      }),
    );
    expect(score.customer).toBe(false);
  });

  it('sin extracción falla todas las métricas que aplican', () => {
    expect(scoreCase(CASE, null, 'EXTRACTION_FAILED')).toMatchObject({
      intent: false,
      customer: false,
      amounts: false,
      paymentMethod: false,
      relatedIds: null,
      error: 'EXTRACTION_FAILED',
    });
  });

  it('solo califica los related_ids que el caso define', () => {
    const score = scoreCase(
      {
        id: 'g-x',
        text: 'comprobante 15',
        expected: {
          intent: 'get_receipt',
          related_ids: { receipt_number: 15 },
        },
      },
      actual({
        intent: 'get_receipt',
        related_ids: {
          invoice_id: null,
          receipt_number: 15,
          external_ref: 'x',
        },
      }),
    );
    expect(score).toMatchObject({
      intent: true,
      relatedIds: true,
      customer: null,
      amounts: null,
    });
  });
});

describe('summarize y metas', () => {
  it('calcula proporciones e ignora los bloques que el caso no define', () => {
    const scores = [
      scoreCase(CASE, actual()),
      scoreCase(CASE, actual({ intent: 'unknown' })),
      scoreCase(
        { id: 'g-u', text: 'hola', expected: { intent: 'unknown' } },
        actual({ intent: 'unknown' }),
      ),
    ];

    const summary = summarize(scores);

    expect(summary.intent).toEqual({ ok: 2, total: 3, ratio: 2 / 3 });
    expect(summary.customerAndAmounts).toEqual({ ok: 2, total: 2, ratio: 1 });
    expect(meetsTargets(summary)).toBe(false);
  });

  it('cumple las metas con 95 % de intención y 90 % de cliente y montos', () => {
    const scores = Array.from({ length: 20 }, () => scoreCase(CASE, actual()));
    scores[0] = scoreCase(CASE, actual({ intent: 'unknown' }));
    expect(meetsTargets(summarize(scores))).toBe(true);
  });
});

describe('compareRuns', () => {
  it('reporta los casos que mejoraron o empeoraron', () => {
    const ok = scoreCase(CASE, actual());
    const bad = scoreCase(CASE, actual({ intent: 'unknown' }));
    const previous = [ok, { ...bad, id: 'g-002' }, { ...ok, id: 'g-003' }];
    const current = [bad, { ...ok, id: 'g-002' }, { ...ok, id: 'g-003' }];

    expect(compareRuns(previous, current)).toEqual([
      { id: 'g-001', change: 'empeoró' },
      { id: 'g-002', change: 'mejoró' },
    ]);
  });
});
