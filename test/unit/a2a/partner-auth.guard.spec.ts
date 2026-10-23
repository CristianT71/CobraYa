import {
  HttpException,
  UnauthorizedException,
  type ExecutionContext,
} from '@nestjs/common';
import {
  QuotaExceededError,
  RateLimitedError,
} from '../../../src/a2a/a2a.errors';
import type { ExchangeAuditService } from '../../../src/a2a/exchange-audit.service';
import {
  MAX_BODY_BYTES,
  PartnerAuthGuard,
  type PartnerRequest,
} from '../../../src/a2a/partner-auth.guard';
import type { Partner } from '../../../src/partners/partner.entity';
import type { PartnersService } from '../../../src/partners/partners.service';

const KEY = `fac_${'a'.repeat(43)}`;

function partner(overrides: Partial<Partner> = {}): Partner {
  return {
    id: 'partner-1',
    slug: 'taller',
    name: 'Taller',
    keyHash: 'h',
    keyPrefix: 'fac_aaaa',
    skills: ['crear_cuenta'],
    active: true,
    ratePerMinute: 30,
    dailyQuota: 500,
    createdAt: new Date(),
    lastUsedAt: null,
    ...overrides,
  } as Partner;
}

function setup(options: { partner?: Partner | null; used?: number } = {}) {
  const found = options.partner === undefined ? partner() : options.partner;
  const findActiveByApiKey = jest.fn().mockResolvedValue(found);
  const touch = jest.fn().mockResolvedValue(undefined);
  const countToday = jest.fn().mockResolvedValue(options.used ?? 0);
  const guard = new PartnerAuthGuard(
    { findActiveByApiKey, touch } as unknown as PartnersService,
    { countToday } as unknown as ExchangeAuditService,
  );

  const headers: Record<string, string> = {};
  const responseHeaders: Record<string, string> = {};
  const req = { headers, ip: '10.0.0.1' } as unknown as PartnerRequest;
  const res = {
    setHeader: (name: string, value: string) => {
      responseHeaders[name] = value;
    },
  };
  const context = {
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
  } as unknown as ExecutionContext;

  return {
    guard,
    context,
    req,
    headers,
    responseHeaders,
    findActiveByApiKey,
    touch,
    countToday,
    withIp: (ip: string) => {
      (req as unknown as { ip: string }).ip = ip;
    },
  };
}

describe('PartnerAuthGuard', () => {
  describe('autenticación', () => {
    it('acepta la key en Authorization: Bearer y deja al negocio en la petición', async () => {
      const s = setup();
      s.headers.authorization = `Bearer ${KEY}`;

      await expect(s.guard.canActivate(s.context)).resolves.toBe(true);

      expect(s.req.partner?.id).toBe('partner-1');
      expect(s.findActiveByApiKey).toHaveBeenCalledWith(KEY);
    });

    it('acepta la key en X-API-Key', async () => {
      const s = setup();
      s.headers['x-api-key'] = KEY;

      await expect(s.guard.canActivate(s.context)).resolves.toBe(true);
      expect(s.findActiveByApiKey).toHaveBeenCalledWith(KEY);
    });

    it('Bearer no distingue mayúsculas en el esquema', async () => {
      const s = setup();
      s.headers.authorization = `bearer ${KEY}`;

      await expect(s.guard.canActivate(s.context)).resolves.toBe(true);
    });

    it('registra el último uso sin esperar y un fallo al guardarlo no rompe la petición', async () => {
      const s = setup();
      s.touch.mockRejectedValue(new Error('db caída'));
      s.headers['x-api-key'] = KEY;

      await expect(s.guard.canActivate(s.context)).resolves.toBe(true);
      expect(s.touch).toHaveBeenCalledTimes(1);
    });

    it.each([
      ['sin key', {}],
      ['Authorization que no es Bearer', { authorization: `Basic ${KEY}` }],
      ['Bearer vacío', { authorization: 'Bearer ' }],
      ['X-API-Key vacía', { 'x-api-key': '   ' }],
    ])('responde 401 %s', async (_name, headers) => {
      const s = setup();
      Object.assign(s.headers, headers);

      await expect(s.guard.canActivate(s.context)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(s.findActiveByApiKey).not.toHaveBeenCalled();
    });

    it('una key falsa, de un negocio desactivado o inexistente dan exactamente la misma respuesta', async () => {
      const outcomes: unknown[] = [];
      for (const found of [null, null]) {
        const s = setup({ partner: found });
        s.headers['x-api-key'] = KEY;
        outcomes.push(
          await s.guard.canActivate(s.context).catch((e: Error) => ({
            name: e.name,
            message: e.message,
            status: (e as UnauthorizedException).getStatus(),
          })),
        );
      }
      const noKey = setup();
      const missing = await noKey.guard
        .canActivate(noKey.context)
        .catch((e: Error) => ({
          name: e.name,
          message: e.message,
          status: (e as UnauthorizedException).getStatus(),
        }));

      expect(outcomes[0]).toEqual(outcomes[1]);
      expect(outcomes[0]).toEqual(missing);
    });
  });

  describe('bloqueo por intentos fallidos (por IP)', () => {
    it('tras 10 fallos bloquea la IP con 429 y Retry-After, incluso con una key válida', async () => {
      const s = setup({ partner: null });
      s.headers['x-api-key'] = KEY;
      for (let i = 0; i < 10; i++) {
        await s.guard.canActivate(s.context).catch(() => undefined);
      }

      s.findActiveByApiKey.mockResolvedValue(partner());
      const error = await s.guard
        .canActivate(s.context)
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(RateLimitedError);
      expect(Number(s.responseHeaders['Retry-After'])).toBeGreaterThan(0);
    });

    it('el bloqueo es por IP: otra IP sigue pudiendo entrar', async () => {
      const s = setup({ partner: null });
      s.headers['x-api-key'] = KEY;
      for (let i = 0; i < 10; i++) {
        await s.guard.canActivate(s.context).catch(() => undefined);
      }

      s.withIp('10.0.0.2');
      s.findActiveByApiKey.mockResolvedValue(partner());

      await expect(s.guard.canActivate(s.context)).resolves.toBe(true);
    });

    it('los intentos válidos no cuentan como fallos', async () => {
      const s = setup();
      s.headers['x-api-key'] = KEY;

      for (let i = 0; i < 15; i++) {
        await expect(s.guard.canActivate(s.context)).resolves.toBe(true);
      }
    });
  });

  describe('límites del negocio', () => {
    it('aplica el límite por minuto con 429 y Retry-After', async () => {
      const s = setup({ partner: partner({ ratePerMinute: 2 }) });
      s.headers['x-api-key'] = KEY;

      await s.guard.canActivate(s.context);
      await s.guard.canActivate(s.context);
      const error = await s.guard
        .canActivate(s.context)
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(RateLimitedError);
      expect(Number(s.responseHeaders['Retry-After'])).toBeGreaterThan(0);
    });

    it('cada negocio tiene su propio contador por minuto', async () => {
      const a = setup({ partner: partner({ id: 'a', ratePerMinute: 1 }) });
      a.headers['x-api-key'] = KEY;
      await a.guard.canActivate(a.context);

      // Mismo guard, otro negocio.
      a.findActiveByApiKey.mockResolvedValue(
        partner({ id: 'b', ratePerMinute: 1 }),
      );

      await expect(a.guard.canActivate(a.context)).resolves.toBe(true);
    });

    it('rechaza con QUOTA_EXCEEDED cuando se agotó la cuota diaria', async () => {
      const s = setup({ partner: partner({ dailyQuota: 100 }), used: 100 });
      s.headers['x-api-key'] = KEY;

      await expect(s.guard.canActivate(s.context)).rejects.toBeInstanceOf(
        QuotaExceededError,
      );
      expect(s.req.partner).toBeUndefined();
    });

    it('con la cuota sin agotar sigue pasando', async () => {
      const s = setup({ partner: partner({ dailyQuota: 100 }), used: 99 });
      s.headers['x-api-key'] = KEY;

      await expect(s.guard.canActivate(s.context)).resolves.toBe(true);
    });
  });

  describe('tamaño del cuerpo', () => {
    it('rechaza con 413 un cuerpo mayor al tope, antes de consultar la base', async () => {
      const s = setup();
      s.headers['x-api-key'] = KEY;
      s.headers['content-length'] = String(MAX_BODY_BYTES + 1);

      const error = await s.guard
        .canActivate(s.context)
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(413);
      expect(s.findActiveByApiKey).not.toHaveBeenCalled();
    });

    it('acepta un cuerpo justo en el tope', async () => {
      const s = setup();
      s.headers['x-api-key'] = KEY;
      s.headers['content-length'] = String(MAX_BODY_BYTES);

      await expect(s.guard.canActivate(s.context)).resolves.toBe(true);
    });
  });
});
