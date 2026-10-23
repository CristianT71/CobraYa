import { ConfigService } from '@nestjs/config';
import {
  RECEIPT_LINK_TTL_SECONDS,
  ReceiptLinkService,
} from '../../../src/receipts/receipt-link.service';

const config = (pepper: string) =>
  ({
    getOrThrow: (key: string) =>
      key === 'partners.keyPepper' ? pepper : 'https://facturacion.test',
  }) as unknown as ConfigService;

const PEPPER = 'a'.repeat(40);
const NOW = Date.UTC(2026, 9, 23, 12, 0, 0);

describe('ReceiptLinkService', () => {
  const service = new ReceiptLinkService(config(PEPPER));

  it('un enlace emitido se verifica y devuelve el número del comprobante', () => {
    expect(service.verify(service.issue(42, NOW), NOW)).toBe(42);
  });

  it('la URL apunta al PDF público con el enlace dentro', () => {
    const url = service.urlFor(7, NOW);
    expect(url).toMatch(
      /^https:\/\/facturacion\.test\/public\/receipts\/[\w-]+\.[\w-]+\/pdf$/,
    );
    const token = url.split('/')[5];
    expect(service.verify(token, NOW)).toBe(7);
  });

  it('vale hasta justo antes de los siete días y después caduca', () => {
    const token = service.issue(5, NOW);
    expect(
      service.verify(token, NOW + (RECEIPT_LINK_TTL_SECONDS - 1) * 1000),
    ).toBe(5);
    expect(
      service.verify(token, NOW + RECEIPT_LINK_TTL_SECONDS * 1000),
    ).toBeNull();
    expect(service.verify(token, NOW + 30 * 24 * 3600 * 1000)).toBeNull();
  });

  it('un enlace con el número cambiado no sirve (no se puede pedir el comprobante de otro)', () => {
    const [payload, signature] = service.issue(5, NOW).split('.');
    const decoded = Buffer.from(payload, 'base64url').toString('utf8');
    const forged = Buffer.from(decoded.replace(/^5\./, '6.')).toString(
      'base64url',
    );
    expect(service.verify(`${forged}.${signature}`, NOW)).toBeNull();
  });

  it('un enlace con la caducidad alargada no sirve', () => {
    const [payload, signature] = service.issue(5, NOW).split('.');
    const [number, expires] = Buffer.from(payload, 'base64url')
      .toString('utf8')
      .split('.');
    const forged = Buffer.from(
      `${number}.${Number(expires) + 999999}`,
    ).toString('base64url');
    expect(service.verify(`${forged}.${signature}`, NOW)).toBeNull();
  });

  it('un enlace firmado con otro secreto no sirve', () => {
    const other = new ReceiptLinkService(config('b'.repeat(40)));
    expect(service.verify(other.issue(5, NOW), NOW)).toBeNull();
  });

  it.each([
    '',
    'abc',
    'a.b.c',
    '.',
    'abc.',
    '.abc',
    'MS4x.'.repeat(3),
    '<script>alert(1)</script>',
    '../../etc/passwd',
  ])('rechaza el texto raro %j sin lanzar errores', (token) => {
    expect(service.verify(token, NOW)).toBeNull();
  });

  it('la firma de otro contexto no vale aunque el contenido sea correcto', () => {
    // El mismo número y la misma caducidad, pero firmados sin el prefijo del contexto.
    const payload = Buffer.from(`5.${Math.floor(NOW / 1000) + 1000}`).toString(
      'base64url',
    );
    expect(service.verify(`${payload}.${'A'.repeat(43)}`, NOW)).toBeNull();
  });
});
