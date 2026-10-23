import { LOG_LEVELS } from './env.validation';

export type LogLevel = (typeof LOG_LEVELS)[number];

export interface AppConfig {
  port: number;
  database: { url: string };
  security: { serviceApiKey: string };
  llm: {
    apiKey: string;
    baseUrl: string;
    model: string;
    timeoutMs: number;
    maxTokens: number;
  };
  billing: {
    /** Decimal como texto (por ejemplo "0.19"); se convierte con decimal.js en el dominio. */
    taxRate: string;
    /** Monto como texto (por ejemplo "50000000.00"). */
    maxInvoiceTotal: string;
  };
  logLevel: LogLevel;
}

export const DEFAULTS = {
  port: 3000,
  llmTimeoutMs: 15000,
  llmMaxTokens: 1000,
  taxRate: '0.19',
  maxInvoiceTotal: '50000000.00',
  logLevel: 'log' as LogLevel,
};

/**
 * Lectura tipada de las variables de entorno. Se usa con
 * `configService.get<AppConfig['llm']>('llm', { infer: true })` o con
 * `configService.getOrThrow('billing.taxRate')`.
 */
export default function configuration(): AppConfig {
  const env = process.env;
  return {
    port: env.PORT ? Number(env.PORT) : DEFAULTS.port,
    database: { url: env.DATABASE_URL ?? '' },
    security: { serviceApiKey: env.SERVICE_API_KEY ?? '' },
    llm: {
      apiKey: env.FIREWORKS_API_KEY ?? '',
      baseUrl: env.FIREWORKS_BASE_URL ?? '',
      model: env.FIREWORKS_MODEL ?? '',
      timeoutMs: env.LLM_TIMEOUT_MS
        ? Number(env.LLM_TIMEOUT_MS)
        : DEFAULTS.llmTimeoutMs,
      maxTokens: env.LLM_MAX_TOKENS
        ? Number(env.LLM_MAX_TOKENS)
        : DEFAULTS.llmMaxTokens,
    },
    billing: {
      taxRate: env.TAX_RATE || DEFAULTS.taxRate,
      maxInvoiceTotal: env.MAX_INVOICE_TOTAL || DEFAULTS.maxInvoiceTotal,
    },
    logLevel: (env.LOG_LEVEL as LogLevel | undefined) ?? DEFAULTS.logLevel,
  };
}
