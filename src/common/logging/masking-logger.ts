import { ConsoleLogger, ConsoleLoggerOptions, LogLevel } from '@nestjs/common';
import { sanitizeForLog } from '../utils/mask-document.util';

const ORDER: LogLevel[] = ['verbose', 'debug', 'log', 'warn', 'error', 'fatal'];

/** Niveles activos a partir de LOG_LEVEL: "warn" activa warn, error y fatal. */
export function logLevelsFrom(level: string | undefined): LogLevel[] {
  const index = ORDER.indexOf((level ?? 'log') as LogLevel);
  return ORDER.slice(index === -1 ? ORDER.indexOf('log') : index);
}

/**
 * Logger JSON estructurado (sección 10.3) que enmascara cédulas y oculta claves
 * antes de escribir. Todo log de la aplicación pasa por aquí.
 */
export class MaskingLogger extends ConsoleLogger {
  constructor(context = 'App', options: ConsoleLoggerOptions = {}) {
    super(context, { json: true, ...options });
  }

  log(message: unknown, ...rest: unknown[]) {
    super.log(sanitizeForLog(message), ...sanitizeForLog(rest));
  }

  error(message: unknown, ...rest: unknown[]) {
    super.error(sanitizeForLog(message), ...sanitizeForLog(rest));
  }

  warn(message: unknown, ...rest: unknown[]) {
    super.warn(sanitizeForLog(message), ...sanitizeForLog(rest));
  }

  debug(message: unknown, ...rest: unknown[]) {
    super.debug(sanitizeForLog(message), ...sanitizeForLog(rest));
  }

  verbose(message: unknown, ...rest: unknown[]) {
    super.verbose(sanitizeForLog(message), ...sanitizeForLog(rest));
  }

  fatal(message: unknown, ...rest: unknown[]) {
    super.fatal(sanitizeForLog(message), ...sanitizeForLog(rest));
  }
}
