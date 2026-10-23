import { createHash, timingSafeEqual } from 'node:crypto';
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

export const API_KEY_HEADER = 'x-api-key';

const sha256 = (value: string) => createHash('sha256').update(value).digest();

/**
 * Autenticación entre servicios (sección 10.1): exige `X-API-Key` igual a
 * SERVICE_API_KEY en todas las rutas, salvo las marcadas con `@Public()`.
 */
@Injectable()
export class ServiceApiKeyGuard implements CanActivate {
  private readonly expected: Buffer;

  constructor(
    private readonly reflector: Reflector,
    config: ConfigService,
  ) {
    this.expected = sha256(config.getOrThrow<string>('security.serviceApiKey'));
  }

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    if (this.hasValidKey(context.switchToHttp().getRequest<Request>())) {
      return true;
    }
    throw new UnauthorizedException('Falta o es inválida la X-API-Key.');
  }

  hasValidKey(req: Request): boolean {
    const provided = req.headers[API_KEY_HEADER];
    // Se comparan los hashes para que el tiempo no dependa de la longitud ni del contenido.
    return (
      typeof provided === 'string' &&
      timingSafeEqual(sha256(provided), this.expected)
    );
  }
}
