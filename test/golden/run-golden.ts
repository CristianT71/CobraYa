import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import OpenAI from 'openai';
import { PROMPT_VERSION } from '../../src/agent/llm/extraction.prompt';
import type { Extraction } from '../../src/agent/llm/extraction.schema';
import { FireworksExtractorAdapter } from '../../src/agent/llm/fireworks-extractor.adapter';
import {
  type CaseScore,
  type GoldenCase,
  type GoldenSummary,
  type Metric,
  TARGETS,
  compareRuns,
  meetsTargets,
  scoreCase,
  summarize,
} from './golden-scoring';

// Ejecuta el dataset dorado contra el modelo real y reporta la precisión
// (contrato, sección 11.2). No forma parte de `npm test`: gasta llamadas.
//
//   npm run golden                       corre todo y compara con la corrida anterior
//   npm run golden -- --only g-001,g-013 corre solo esos casos
//   npm run golden -- --compare <archivo> compara con una corrida concreta
//   npm run golden -- --concurrency 4    llamadas en paralelo (por defecto 2)

const ROOT = __dirname;
const DATASET = join(ROOT, 'golden-dataset.json');
const RESULTS_DIR = join(ROOT, 'results');

interface RunFile {
  promptVersion: string;
  model: string;
  runAt: string;
  summary: GoldenSummary;
  cases: CaseScore[];
}

function parseArgs(argv: string[]) {
  const value = (flag: string) => {
    const index = argv.indexOf(flag);
    return index === -1 ? undefined : argv[index + 1];
  };
  return {
    only: value('--only')
      ?.split(',')
      .map((id) => id.trim()),
    compare: value('--compare'),
    concurrency: Number(value('--concurrency') ?? 2),
  };
}

function loadEnv(): void {
  try {
    process.loadEnvFile(join(ROOT, '../../.env'));
  } catch {
    // Sin .env: se usan las variables ya definidas en la terminal.
  }
  const missing = [
    'FIREWORKS_API_KEY',
    'FIREWORKS_BASE_URL',
    'FIREWORKS_MODEL',
  ].filter((name) => !process.env[name]);
  if (missing.length > 0) {
    console.error(`Faltan variables de entorno: ${missing.join(', ')}`);
    process.exit(2);
  }
}

function createExtractor(): FireworksExtractorAdapter {
  const client = new OpenAI({
    apiKey: process.env.FIREWORKS_API_KEY,
    baseURL: process.env.FIREWORKS_BASE_URL,
    timeout: Number(process.env.LLM_TIMEOUT_MS ?? 15000),
    maxRetries: 0,
  });
  return new FireworksExtractorAdapter(
    { create: (params) => client.chat.completions.create(params) },
    {
      model: process.env.FIREWORKS_MODEL as string,
      maxTokens: Number(process.env.LLM_MAX_TOKENS ?? 1000),
    },
  );
}

async function runCases(
  cases: GoldenCase[],
  extractor: FireworksExtractorAdapter,
  concurrency: number,
): Promise<CaseScore[]> {
  const scores: CaseScore[] = [];
  let next = 0;
  const worker = async () => {
    while (next < cases.length) {
      const index = next++;
      const testCase = cases[index];
      let actual: Extraction | null = null;
      let error: string | null = null;
      try {
        actual = await extractor.extract(testCase.text, {
          requestId: `golden-${testCase.id}`,
        });
      } catch (e) {
        error = e instanceof Error && 'code' in e ? String(e.code) : String(e);
      }
      scores[index] = scoreCase(testCase, actual, error);
      process.stdout.write(scores[index].error ? 'E' : '.');
    }
  };
  await Promise.all(
    Array.from({ length: Math.max(1, concurrency) }, () => worker()),
  );
  process.stdout.write('\n');
  return scores;
}

const pct = (m: Metric) =>
  `${(m.ratio * 100).toFixed(1)} % (${m.ok}/${m.total})`;

function printSummary(summary: GoldenSummary): void {
  const rows: Array<[string, Metric, number?]> = [
    ['Intención', summary.intent, TARGETS.intent],
    [
      'Cliente y montos',
      summary.customerAndAmounts,
      TARGETS.customerAndAmounts,
    ],
    ['  Cliente', summary.customer],
    ['  Montos', summary.amounts],
    ['Método de pago', summary.paymentMethod],
    ['IDs relacionados', summary.relatedIds],
  ];
  console.log(
    `\nCasos: ${summary.cases}   Errores de extracción: ${summary.errors}`,
  );
  for (const [label, metric, target] of rows) {
    const goal =
      target === undefined
        ? ''
        : metric.ratio >= target
          ? `  ✔ meta ${target * 100} %`
          : `  ✘ meta ${target * 100} %`;
    console.log(`${label.padEnd(18)} ${pct(metric)}${goal}`);
  }
}

function printFailures(cases: GoldenCase[], scores: CaseScore[]): void {
  const byId = new Map(cases.map((c) => [c.id, c]));
  const failed = scores.filter((s) =>
    [s.intent, s.customer, s.amounts, s.paymentMethod, s.relatedIds].includes(
      false,
    ),
  );
  if (failed.length === 0) return;
  console.log('\nCasos con fallas:');
  for (const score of failed) {
    const fields = (
      ['intent', 'customer', 'amounts', 'paymentMethod', 'relatedIds'] as const
    ).filter((field) => score[field] === false);
    console.log(
      `\n- ${score.id} [${fields.join(', ')}] ${byId.get(score.id)?.text}`,
    );
    if (score.error) console.log(`  error: ${score.error}`);
    console.log(`  esperado: ${JSON.stringify(byId.get(score.id)?.expected)}`);
    if (score.actual) {
      const { intent, customer, items, payment, related_ids } = score.actual;
      console.log(
        `  obtenido: ${JSON.stringify({ intent, customer, items, payment, related_ids })}`,
      );
    }
  }
}

function latestRun(): string | undefined {
  if (!existsSync(RESULTS_DIR)) return undefined;
  return readdirSync(RESULTS_DIR)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .at(-1);
}

function printComparison(previousPath: string, current: RunFile): void {
  const previous = JSON.parse(readFileSync(previousPath, 'utf8')) as RunFile;
  const delta = (key: keyof GoldenSummary) => {
    const before = previous.summary[key] as Metric;
    const after = current.summary[key] as Metric;
    const diff = (after.ratio - before.ratio) * 100;
    return `${(before.ratio * 100).toFixed(1)} % -> ${(after.ratio * 100).toFixed(1)} % (${diff >= 0 ? '+' : ''}${diff.toFixed(1)})`;
  };
  console.log(
    `\nComparación con ${previous.promptVersion} (${previous.runAt}):`,
  );
  console.log(`Intención         ${delta('intent')}`);
  console.log(`Cliente y montos  ${delta('customerAndAmounts')}`);
  for (const change of compareRuns(previous.cases, current.cases)) {
    console.log(`  ${change.id} ${change.change}`);
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  loadEnv();

  const all = JSON.parse(readFileSync(DATASET, 'utf8')) as GoldenCase[];
  const cases = args.only ? all.filter((c) => args.only!.includes(c.id)) : all;
  const model = process.env.FIREWORKS_MODEL as string;
  console.log(
    `Dataset dorado: ${cases.length} casos · prompt ${PROMPT_VERSION} · ${model}`,
  );

  const previous = args.compare ?? latestRun();
  const scores = await runCases(cases, createExtractor(), args.concurrency);
  const summary = summarize(scores);
  const run: RunFile = {
    promptVersion: PROMPT_VERSION,
    model,
    runAt: new Date().toISOString(),
    summary,
    cases: scores,
  };

  printSummary(summary);
  printFailures(cases, scores);

  // Solo se guardan las corridas completas, para comparar versiones del prompt.
  if (!args.only) {
    mkdirSync(RESULTS_DIR, { recursive: true });
    const file = join(
      RESULTS_DIR,
      `${run.runAt.replace(/[:.]/g, '-')}_prompt-${PROMPT_VERSION}.json`,
    );
    writeFileSync(file, `${JSON.stringify(run, null, 2)}\n`);
    console.log(`\nResultados guardados en ${file}`);
  }
  if (previous) {
    printComparison(
      previous.includes('/') || previous.includes('\\')
        ? previous
        : join(RESULTS_DIR, previous),
      run,
    );
  }

  process.exitCode = meetsTargets(summary) ? 0 : 1;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(2);
});
