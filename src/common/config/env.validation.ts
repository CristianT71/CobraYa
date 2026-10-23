import { plainToInstance } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  Max,
  Min,
  MinLength,
  validateSync,
} from 'class-validator';

export const LOG_LEVELS = [
  'fatal',
  'error',
  'warn',
  'log',
  'debug',
  'verbose',
] as const;

// Montos y tasas se validan como texto decimal: nunca pasan por number.
const DECIMAL = /^\d+(\.\d{1,4})?$/;

/**
 * Variables de entorno de la sección 10.4 del contrato.
 * Si falta una obligatoria o un valor no tiene el formato esperado,
 * la aplicación no arranca.
 */
export class EnvironmentVariables {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  PORT?: number;

  @IsString()
  @IsNotEmpty()
  DATABASE_URL: string;

  @IsString()
  @IsNotEmpty()
  SERVICE_API_KEY: string;

  @IsString()
  @IsNotEmpty()
  FIREWORKS_API_KEY: string;

  @IsUrl({ require_tld: false })
  FIREWORKS_BASE_URL: string;

  @IsString()
  @IsNotEmpty()
  FIREWORKS_MODEL: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  LLM_TIMEOUT_MS?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  LLM_MAX_TOKENS?: number;

  // Secreto con el que se calcula el hash de las keys de los negocios (A2A).
  @IsString()
  @MinLength(32, {
    message:
      'PARTNER_KEY_PEPPER debe tener al menos 32 caracteres (por ejemplo: openssl rand -hex 32)',
  })
  PARTNER_KEY_PEPPER: string;

  // URL pública del servicio; la anuncia la tarjeta del bot. Por defecto, localhost.
  @IsOptional()
  @IsUrl({ require_tld: false })
  A2A_PUBLIC_BASE_URL?: string;

  // Cuántos proxies hay delante del servicio (Render, Railway...: 1). Con 0 no se
  // confía en X-Forwarded-For. Sin esto, tras un proxy todos los clientes tendrían
  // la misma IP y el bloqueo por intentos fallidos afectaría a todos a la vez.
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(5)
  TRUST_PROXY?: number;

  @IsOptional()
  @Matches(DECIMAL, { message: 'TAX_RATE debe ser un decimal como 0.19 o 0' })
  TAX_RATE?: string;

  @IsOptional()
  @Matches(/^\d+(\.\d{1,2})?$/, {
    message: 'MAX_INVOICE_TOTAL debe ser un monto como 50000000 o 50000000.00',
  })
  MAX_INVOICE_TOTAL?: string;

  @IsOptional()
  @IsIn(LOG_LEVELS)
  LOG_LEVEL?: (typeof LOG_LEVELS)[number];
}

const OPTIONAL_KEYS = [
  'PORT',
  'LLM_TIMEOUT_MS',
  'LLM_MAX_TOKENS',
  'A2A_PUBLIC_BASE_URL',
  'TRUST_PROXY',
  'TAX_RATE',
  'MAX_INVOICE_TOTAL',
  'LOG_LEVEL',
] as const;

export function validateEnv(
  config: Record<string, unknown>,
): EnvironmentVariables {
  const env = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: false,
  });
  // Una variable opcional vacía en el .env cuenta como ausente.
  for (const key of OPTIONAL_KEYS) {
    if (config[key] === '') delete env[key];
  }
  // Los enteros llegan como texto desde el .env; montos y tasas siguen como texto.
  for (const key of [
    'PORT',
    'LLM_TIMEOUT_MS',
    'LLM_MAX_TOKENS',
    'TRUST_PROXY',
  ] as const) {
    if (env[key] !== undefined) env[key] = Number(env[key]);
  }

  const errors = validateSync(env, { skipMissingProperties: false });
  if (errors.length > 0) {
    const detail = errors
      .map(
        (e) =>
          `${e.property}: ${Object.values(e.constraints ?? {}).join(', ')}`,
      )
      .join('\n  ');
    throw new Error(
      `Configuración inválida en variables de entorno:\n  ${detail}`,
    );
  }
  return env;
}
