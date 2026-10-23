import Decimal from 'decimal.js';
import {
  AMOUNT_REGEX,
  type Extraction,
} from '../../src/agent/llm/extraction.schema';

// Calificación del dataset dorado (contrato, sección 11.2). Funciones puras:
// las prueba Jest sin llamar al modelo.

// Metas de la sección 11.4.
export const TARGETS = { intent: 0.95, customerAndAmounts: 0.9 };

// Lo esperado de cada caso. Solo se califican los bloques presentes; la
// descripción de los ítems es texto libre y no se califica.
export interface ExpectedExtraction {
  intent: Extraction['intent'];
  customer?: Extraction['customer'];
  items?: Array<{
    description?: string;
    quantity: number;
    unit_price: string;
  }>;
  payment?: Extraction['payment'];
  related_ids?: Partial<Extraction['related_ids']>;
}

export interface GoldenCase {
  id: string;
  text: string;
  tags?: string[];
  expected: ExpectedExtraction;
}

export interface CaseScore {
  id: string;
  intent: boolean;
  // null: el caso no define ese bloque y no cuenta para la métrica.
  customer: boolean | null;
  amounts: boolean | null;
  paymentMethod: boolean | null;
  relatedIds: boolean | null;
  error: string | null;
  actual: Extraction | null;
}

export interface Metric {
  ok: number;
  total: number;
  ratio: number;
}

export interface GoldenSummary {
  cases: number;
  errors: number;
  intent: Metric;
  // Meta del contrato: cliente y montos correctos en el mismo caso.
  customerAndAmounts: Metric;
  customer: Metric;
  amounts: Metric;
  paymentMethod: Metric;
  relatedIds: Metric;
}

// "80000" y "80000.00" son el mismo monto; otros textos se comparan tal cual.
export function sameAmount(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return a === b;
  if (AMOUNT_REGEX.test(a) && AMOUNT_REGEX.test(b)) {
    return new Decimal(a).equals(b);
  }
  return a.trim() === b.trim();
}

function sameQuantity(a: number, b: number): boolean {
  return Number.isFinite(a) && Number.isFinite(b) && new Decimal(a).equals(b);
}

// Los ítems se comparan como conjunto: el orden no importa.
function sameItems(
  expected: NonNullable<ExpectedExtraction['items']>,
  actual: Extraction['items'],
): boolean {
  if (expected.length !== actual.length) return false;
  const pending = [...actual];
  return expected.every((item) => {
    const index = pending.findIndex(
      (candidate) =>
        sameQuantity(candidate.quantity, item.quantity) &&
        sameAmount(candidate.unit_price, item.unit_price),
    );
    if (index === -1) return false;
    pending.splice(index, 1);
    return true;
  });
}

export function scoreCase(
  testCase: GoldenCase,
  actual: Extraction | null,
  error: string | null = null,
): CaseScore {
  const { expected } = testCase;
  const has = (block: unknown) => block !== undefined;
  if (actual === null) {
    // Un fallo de extracción cuenta como error en todas las métricas que aplican.
    const fail = (block: unknown) => (has(block) ? false : null);
    return {
      id: testCase.id,
      intent: false,
      customer: fail(expected.customer),
      amounts: has(expected.items) || has(expected.payment) ? false : null,
      paymentMethod: fail(expected.payment),
      relatedIds: fail(expected.related_ids),
      error: error ?? 'sin extracción',
      actual: null,
    };
  }

  const customer = expected.customer
    ? expected.customer.document_type === actual.customer.document_type &&
      expected.customer.document_number === actual.customer.document_number
    : null;

  let amounts: boolean | null = null;
  if (expected.items || expected.payment) {
    amounts =
      (!expected.items || sameItems(expected.items, actual.items)) &&
      (!expected.payment ||
        sameAmount(expected.payment.amount, actual.payment.amount));
  }

  const paymentMethod = expected.payment
    ? expected.payment.method === actual.payment.method
    : null;

  const relatedIds = expected.related_ids
    ? Object.entries(expected.related_ids).every(
        ([key, value]) =>
          actual.related_ids[key as keyof Extraction['related_ids']] === value,
      )
    : null;

  return {
    id: testCase.id,
    intent: expected.intent === actual.intent,
    customer,
    amounts,
    paymentMethod,
    relatedIds,
    error,
    actual,
  };
}

function metric(values: Array<boolean | null>): Metric {
  const counted = values.filter((v): v is boolean => v !== null);
  const ok = counted.filter(Boolean).length;
  return {
    ok,
    total: counted.length,
    ratio: counted.length === 0 ? 1 : ok / counted.length,
  };
}

export function summarize(scores: CaseScore[]): GoldenSummary {
  return {
    cases: scores.length,
    errors: scores.filter((s) => s.error !== null).length,
    intent: metric(scores.map((s) => s.intent)),
    customerAndAmounts: metric(
      scores.map((s) =>
        s.customer === null && s.amounts === null
          ? null
          : s.customer !== false && s.amounts !== false,
      ),
    ),
    customer: metric(scores.map((s) => s.customer)),
    amounts: metric(scores.map((s) => s.amounts)),
    paymentMethod: metric(scores.map((s) => s.paymentMethod)),
    relatedIds: metric(scores.map((s) => s.relatedIds)),
  };
}

export function meetsTargets(summary: GoldenSummary): boolean {
  return (
    summary.intent.ratio >= TARGETS.intent &&
    summary.customerAndAmounts.ratio >= TARGETS.customerAndAmounts
  );
}

export interface CaseChange {
  id: string;
  change: 'mejoró' | 'empeoró';
}

function passed(score: CaseScore): boolean {
  return [
    score.intent,
    score.customer,
    score.amounts,
    score.paymentMethod,
    score.relatedIds,
  ].every((v) => v !== false);
}

// Casos que cambiaron de resultado entre dos corridas (por ejemplo, entre
// versiones del prompt).
export function compareRuns(
  previous: CaseScore[],
  current: CaseScore[],
): CaseChange[] {
  const before = new Map(previous.map((s) => [s.id, passed(s)]));
  return current.flatMap((score): CaseChange[] => {
    const was = before.get(score.id);
    const now = passed(score);
    if (was === undefined || was === now) return [];
    return [{ id: score.id, change: now ? 'mejoró' : 'empeoró' }];
  });
}
