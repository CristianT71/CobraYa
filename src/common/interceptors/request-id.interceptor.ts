import { randomUUID } from 'node:crypto';
import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Observable, map, tap } from 'rxjs';

export const REQUEST_ID_HEADER = 'X-Request-Id';

// Mismo largo que llm_call_logs.request_id (varchar(64)).
const VALID_ID = /^[\w.:-]{1,64}$/;

type RequestWithId = Request & { requestId?: string };

/**
 * Devuelve el request_id de la petición y lo deja guardado en ella.
 * Orden: encabezado X-Request-Id, campo `request_id` del cuerpo y, si no hay
 * ninguno válido, un UUID nuevo. Lo usan el interceptor, el filtro y el
 * orquestador para que todos vean el mismo valor.
 */
export function resolveRequestId(req: Request): string {
  const r = req as RequestWithId;
  if (r.requestId) return r.requestId;

  const fromHeader = req.headers[REQUEST_ID_HEADER.toLowerCase()];
  const fromBody: unknown = (req.body as Record<string, unknown> | undefined)
    ?.request_id;
  const candidate = [fromHeader, fromBody].find(
    (v): v is string => typeof v === 'string' && VALID_ID.test(v),
  );
  r.requestId = candidate ?? randomUUID();
  return r.requestId;
}

/**
 * Propaga el request_id (sección 10.3): lo devuelve en el encabezado
 * X-Request-Id, lo agrega al cuerpo de las respuestas JSON que no lo traigan
 * y deja una línea de log por petición.
 */
@Injectable()
export class RequestIdInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    const requestId = resolveRequestId(req);
    const startedAt = Date.now();
    res.setHeader(REQUEST_ID_HEADER, requestId);

    return next.handle().pipe(
      map((body: unknown) => {
        if (
          body &&
          typeof body === 'object' &&
          !Array.isArray(body) &&
          !('request_id' in body)
        ) {
          return { ...body, request_id: requestId };
        }
        return body;
      }),
      tap(() =>
        this.logger.log({
          request_id: requestId,
          method: req.method,
          path: req.path,
          status_code: res.statusCode,
          latency_ms: Date.now() - startedAt,
        }),
      ),
    );
  }
}
