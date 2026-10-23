import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type { Partner } from '../partners/partner.entity';
import { PartnersService } from '../partners/partners.service';
import { QuotaExceededError, RateLimitedError } from './a2a.errors';
import { ExchangeAuditService } from './exchange-audit.service';
import { FailureLockout, SlidingWindowLimiter } from './rate-limiter';

export type PartnerRequest = Request & { partner?: Partner };

// Cuerpo máximo de una tarea (las solicitudes legítimas son de pocos cientos de bytes).
export const MAX_BODY_BYTES = 16 * 1024;
const RATE_WINDOW_MS = 60_000;

// La misma respuesta para una key ausente, falsa, mal formada o de un negocio
// desactivado: quien llama no puede averiguar cuáles keys existen.
const UNAUTHORIZED_MESSAGE = 'Falta o es inválida la key del negocio.';

/**
 * Autenticación de los negocios en /a2a/tasks. Acepta la key en
 * `Authorization: Bearer <key>` o en `X-API-Key`. Después aplica, en orden:
 * bloqueo por IP tras intentos fallidos, límite por minuto y cuota diaria del negocio.
 */
@Injectable()
export class PartnerAuthGuard implements CanActivate {
  private readonly logger = new Logger(PartnerAuthGuard.name);
  private readonly limiter = new SlidingWindowLimiter();
  private readonly lockout = new FailureLockout();

  constructor(
    private readonly partners: PartnersService,
    private readonly audit: ExchangeAuditService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const req = http.getRequest<PartnerRequest>();
    const res = http.getResponse<Response>();
    const ip = req.ip ?? 'desconocida';

    const contentLength = Number(req.headers['content-length'] ?? 0);
    if (contentLength > MAX_BODY_BYTES) {
      throw new HttpException(
        'La petición es demasiado grande.',
        HttpStatus.PAYLOAD_TOO_LARGE,
      );
    }

    const blockedMs = this.lockout.remainingMs(ip);
    if (blockedMs > 0) {
      res.setHeader('Retry-After', String(Math.ceil(blockedMs / 1000)));
      throw new RateLimitedError(
        'Demasiados intentos con una key inválida; intenta más tarde.',
      );
    }

    const key = extractKey(req);
    const partner = key ? await this.partners.findActiveByApiKey(key) : null;
    if (!partner) {
      this.lockout.recordFailure(ip);
      throw new UnauthorizedException(UNAUTHORIZED_MESSAGE);
    }

    const hit = this.limiter.tryHit(
      partner.id,
      partner.ratePerMinute,
      RATE_WINDOW_MS,
    );
    if (!hit.allowed) {
      res.setHeader('Retry-After', String(Math.ceil(hit.retryAfterMs / 1000)));
      throw new RateLimitedError();
    }

    if ((await this.audit.countToday(partner.id)) >= partner.dailyQuota) {
      throw new QuotaExceededError();
    }

    req.partner = partner;
    // last_used_at es informativo: un fallo al guardarlo no puede romper la petición.
    this.partners.touch(partner).catch((error: unknown) => {
      this.logger.warn(
        `No se pudo actualizar last_used_at: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    });
    return true;
  }
}

function extractKey(req: Request): string | null {
  const authorization = req.headers.authorization;
  if (typeof authorization === 'string') {
    const match = /^Bearer\s+(\S+)$/i.exec(authorization.trim());
    if (match) return match[1];
  }
  const apiKey = req.headers['x-api-key'];
  return typeof apiKey === 'string' && apiKey.trim() ? apiKey.trim() : null;
}
