import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { TypeORMError } from 'typeorm';
import {
  ERROR_CATALOG,
  ErrorCode,
  ResponseEnvelope,
  isCatalogError,
  isErrorCode,
} from '../errors/error-catalog';
import {
  REQUEST_ID_HEADER,
  resolveRequestId,
} from '../interceptors/request-id.interceptor';
import { maskDocumentsInText } from '../utils/mask-document.util';

interface Translated {
  code: ErrorCode;
  message: string;
  missingFields: string[];
  httpStatus?: number;
}

const AGENT_PATH = /^\/(agent|a2a)(\/|$)/;
// Solo el canal de negocios agrega `answer` (texto listo para mostrar) a sus respuestas.
const A2A_PATH = /^\/a2a(\/|$)/;
// Las descargas de PDF usan códigos HTTP reales (404, 403...): quien descarga un
// archivo no espera un JSON con 200 que diga «rejected».
const DOWNLOAD_PATH = /\/pdf$/;

const HTTP_TO_CODE: Partial<Record<number, ErrorCode>> = {
  [HttpStatus.BAD_REQUEST]: 'VALIDATION_ERROR',
  [HttpStatus.PAYLOAD_TOO_LARGE]: 'VALIDATION_ERROR',
  [HttpStatus.UNSUPPORTED_MEDIA_TYPE]: 'VALIDATION_ERROR',
  [HttpStatus.UNAUTHORIZED]: 'UNAUTHORIZED',
  [HttpStatus.NOT_FOUND]: 'NOT_FOUND',
  [HttpStatus.CONFLICT]: 'IDEMPOTENCY_CONFLICT',
  [HttpStatus.UNPROCESSABLE_ENTITY]: 'MISSING_FIELDS',
  [HttpStatus.BAD_GATEWAY]: 'LLM_UNAVAILABLE',
  [HttpStatus.GATEWAY_TIMEOUT]: 'LLM_UNAVAILABLE',
};

const GENERIC_MESSAGES: Partial<Record<ErrorCode, string>> = {
  DB_ERROR: 'Falla de base de datos; no se guardó nada.',
  INTERNAL_ERROR: 'Error interno del servicio; no se guardó nada.',
};

/**
 * Traduce cualquier excepción al envoltorio de la sección 7.4 con
 * `data.error_code` (sección 9). En /agent/* y /a2a/* los resultados de negocio
 * (rejected, needs_clarification) responden 200; en el camino directo usan
 * el código del catálogo (422, 409, etc.). Los fallos técnicos nunca exponen
 * detalles internos al supervisor.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  /**
   * @param hasValidKey Si se pasa, una ruta inexistente pedida sin API key
   * válida responde 401 en vez de 404, para no revelar qué rutas existen.
   */
  constructor(private readonly hasValidKey?: (req: Request) => boolean) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    const requestId = resolveRequestId(req);

    let t = this.translate(exception);
    if (t.code === 'NOT_FOUND' && this.hasValidKey && !this.hasValidKey(req)) {
      t = {
        code: 'UNAUTHORIZED',
        message: 'Falta o es inválida la X-API-Key.',
        missingFields: [],
        httpStatus: HttpStatus.UNAUTHORIZED,
      };
    }
    const entry = ERROR_CATALOG[t.code];
    const isBusinessResult = 'business' in entry;
    const httpStatus =
      t.httpStatus ??
      (isBusinessResult &&
      AGENT_PATH.test(req.path) &&
      !DOWNLOAD_PATH.test(req.path)
        ? 200
        : entry.httpStatus);

    const body: ResponseEnvelope<{ error_code: ErrorCode } | null> = {
      status: entry.status,
      // Los mensajes pueden repetir la URL o el cuerpo; nunca devuelven una cédula completa.
      message: GENERIC_MESSAGES[t.code] ?? maskDocumentsInText(t.message),
      data:
        entry.status === 'needs_clarification' ? null : { error_code: t.code },
      missing_fields: t.missingFields,
      request_id: requestId,
    };
    const payload = A2A_PATH.test(req.path)
      ? { ...body, answer: body.message }
      : body;

    const log = {
      request_id: requestId,
      method: req.method,
      path: req.path,
      status_code: httpStatus,
      error_code: t.code,
      message: t.message,
    };
    if (entry.status === 'error') {
      this.logger.error(
        log,
        exception instanceof Error ? exception.stack : undefined,
      );
    } else {
      this.logger.warn(log);
    }

    if (res.headersSent) return;
    res.setHeader(REQUEST_ID_HEADER, requestId);
    res.status(httpStatus).json(payload);
  }

  private translate(exception: unknown): Translated {
    if (isCatalogError(exception)) {
      return {
        code: exception.code,
        message: exception.message,
        missingFields: exception.missingFields ?? [],
        httpStatus:
          exception.httpStatus ??
          (exception.timedOut === true
            ? HttpStatus.GATEWAY_TIMEOUT
            : undefined),
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const response = exception.getResponse();
      const details =
        typeof response === 'object' && response !== null
          ? (response as Record<string, unknown>)
          : {};
      const explicit = details.error_code;
      const code: ErrorCode = isErrorCode(explicit)
        ? explicit
        : (HTTP_TO_CODE[status] ??
          (status >= 500 ? 'INTERNAL_ERROR' : 'VALIDATION_ERROR'));
      return {
        code,
        message: messageOf(details.message) ?? exception.message,
        missingFields: Array.isArray(details.missing_fields)
          ? details.missing_fields.filter(
              (f): f is string => typeof f === 'string',
            )
          : [],
        httpStatus: status,
      };
    }

    // Errores de body-parser de Express (JSON mal formado, cuerpo demasiado grande).
    const raw = exception as {
      status?: unknown;
      type?: unknown;
      message?: unknown;
    };
    if (
      typeof raw?.status === 'number' &&
      raw.status >= 400 &&
      raw.status < 500 &&
      typeof raw.type === 'string'
    ) {
      return {
        code: 'VALIDATION_ERROR',
        message:
          raw.type === 'entity.parse.failed'
            ? 'El cuerpo no es JSON válido.'
            : String(raw.message),
        missingFields: [],
        httpStatus: raw.status,
      };
    }

    if (exception instanceof TypeORMError) {
      return {
        code: 'DB_ERROR',
        message: exception.message,
        missingFields: [],
      };
    }

    return {
      code: 'INTERNAL_ERROR',
      message:
        exception instanceof Error ? exception.message : String(exception),
      missingFields: [],
    };
  }
}

function messageOf(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (Array.isArray(value))
    return value.filter((v) => typeof v === 'string').join('; ');
  return undefined;
}
