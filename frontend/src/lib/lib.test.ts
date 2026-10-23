import { describe, expect, it } from 'vitest';
import { notFoundEnvelope, jsonResponse, mockFetch } from '../test/helpers';
import { ApiError, api, toApiError } from './api';
import { formatCop, formatDate, newIdempotencyKey } from './format';
import { parseHash } from './route';

describe('formatCop', () => {
  it.each([
    ['124950.00', '$124.950'],
    ['0.00', '$0'],
    ['999.00', '$999'],
    ['1000.00', '$1.000'],
    ['50000000.00', '$50.000.000'],
    ['1234.50', '$1.234,50'],
    ['0.05', '$0,05'],
    ['19950', '$19.950'],
  ])('%s -> %s', (input, expected) => {
    expect(formatCop(input)).toBe(expected);
  });
});

describe('formatDate', () => {
  it('formatea en hora de Bogotá', () => {
    // 21:50 UTC son las 16:50 en Bogotá (UTC-5).
    expect(formatDate('2026-10-21T21:50:00.000Z')).toMatch(/16:50|4:50/);
  });

  it('devuelve el texto tal cual si no es una fecha', () => {
    expect(formatDate('no es una fecha')).toBe('no es una fecha');
  });
});

describe('newIdempotencyKey', () => {
  it('genera claves distintas con prefijo web-, válidas para el servicio (≤ 79, visibles)', () => {
    const keys = new Set(Array.from({ length: 50 }, newIdempotencyKey));

    expect(keys.size).toBe(50);
    for (const key of keys) {
      expect(key.startsWith('web-')).toBe(true);
      expect(key.length).toBeLessThanOrEqual(79);
      expect(key).toMatch(/^[\x21-\x7e]+$/);
    }
  });
});

describe('parseHash', () => {
  it.each([
    ['', '/'],
    ['#', '/'],
    ['#/', '/'],
    ['#/negocios', '/negocios'],
    ['#/comprobantes', '/comprobantes'],
    ['#/panel', '/panel'],
    ['#/panel?x=1', '/panel'],
    ['#/no-existe', '/'],
    ['#/admin', '/'],
    ['#//negocios', '/'],
  ])('%j -> %s', (hash, expected) => {
    expect(parseHash(hash)).toBe(expected);
  });
});

describe('toApiError', () => {
  it('lee el código, el mensaje y los campos faltantes del envoltorio del contrato', () => {
    const response = jsonResponse({}, 400);
    const error = toApiError(response, {
      ...notFoundEnvelope('VALIDATION_ERROR', 'Datos inválidos en: items.'),
      missing_fields: ['items', 3],
    });

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 400,
      code: 'VALIDATION_ERROR',
      message: 'Datos inválidos en: items.',
      missingFields: ['items'],
    });
  });

  it('lee Retry-After cuando es un número positivo', () => {
    const limited = jsonResponse({}, 429, { 'Retry-After': '120' });
    expect(toApiError(limited, {}).retryAfterSeconds).toBe(120);

    const invalid = jsonResponse({}, 429, { 'Retry-After': 'pronto' });
    expect(toApiError(invalid, {}).retryAfterSeconds).toBeNull();
  });

  it.each([null, 'texto', 42, [], {}])('con el cuerpo %j usa un mensaje genérico', (body) => {
    const error = toApiError(jsonResponse({}, 502), body);

    expect(error.message).toBe('Error 502');
    expect(error.code).toBeNull();
  });
});

describe('api', () => {
  it('traduce un corte de red a un ApiError con estado 0', async () => {
    mockFetch(() => new Error('offline'));

    await expect(api.info()).rejects.toMatchObject({ status: 0, code: 'NETWORK' });
  });

  it('traduce una respuesta de error a un ApiError con el código del servicio', async () => {
    mockFetch(() => ({ status: 404, body: notFoundEnvelope('RECEIPT_NOT_FOUND') }));

    await expect(api.verifyReceipt(1, '1032456789')).rejects.toMatchObject({
      status: 404,
      code: 'RECEIPT_NOT_FOUND',
    });
  });

  it('health responde true solo con una respuesta correcta y false si falla la red', async () => {
    mockFetch(() => ({ body: { status: 'ok' } }));
    expect(await api.health()).toBe(true);

    mockFetch(() => ({ status: 503, body: { status: 'error' } }));
    expect(await api.health()).toBe(false);

    mockFetch(() => new Error('offline'));
    expect(await api.health()).toBe(false);
  });

  it('sendTask envía la key como Bearer y la Idempotency-Key, y devuelve la respuesta tal cual', async () => {
    const { calls } = mockFetch(() => ({ status: 403, body: { status: 'rejected' } }));

    const result = await api.sendTask('fac_abc', { message: 'hola' }, 'web-1');

    expect(calls[0]).toMatchObject({
      url: '/a2a/tasks',
      method: 'POST',
      headers: {
        authorization: 'Bearer fac_abc',
        'idempotency-key': 'web-1',
        'content-type': 'application/json',
      },
      body: { message: 'hola' },
    });
    expect(result).toEqual({ status: 403, body: { status: 'rejected' } });
  });

  it('sendTask sin clave de idempotencia no manda el encabezado', async () => {
    const { calls } = mockFetch(() => ({ body: {} }));

    await api.sendTask('fac_abc', { message: 'hola' }, '');

    expect(calls[0].headers).not.toHaveProperty('idempotency-key');
  });

  it('las rutas del operador envían la clave de servicio en X-API-Key', async () => {
    const { calls } = mockFetch(() => ({ body: [] }));

    await api.admin.listPartners('clave-servicio');
    await api.admin.exchanges('clave-servicio', 'abc', 5);

    expect(calls[0]).toMatchObject({
      url: '/admin/partners',
      headers: { 'x-api-key': 'clave-servicio' },
    });
    expect(calls[1]).toMatchObject({
      url: '/admin/partners/abc/exchanges?limit=5',
      headers: { 'x-api-key': 'clave-servicio' },
    });
  });

  it('las rutas del operador usan el método correcto y nunca mandan la key en la URL', async () => {
    const { calls } = mockFetch(() => ({ body: {} }));

    await api.admin.createPartner('k', { slug: 'taller', name: 'Taller', skills: ['crear_cuenta'] });
    await api.admin.updatePartner('k', 'id-1', { active: false });
    await api.admin.rotateKey('k', 'id-1');

    expect(calls.map((c) => [c.method, c.url])).toEqual([
      ['POST', '/admin/partners'],
      ['PATCH', '/admin/partners/id-1'],
      ['POST', '/admin/partners/id-1/rotate-key'],
    ]);
    expect(calls.every((c) => !c.url.includes('k='))).toBe(true);
  });
});
