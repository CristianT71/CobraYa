import { createHmac, randomBytes } from 'node:crypto';

// Keys de los negocios. Se muestran UNA sola vez al crearlas o rotarlas; en la
// base solo queda su HMAC-SHA256 con un pepper del servidor (PARTNER_KEY_PEPPER),
// así que un volcado de la tabla no sirve para llamar al servicio.

export const KEY_PREFIX = 'fac_';
// 32 bytes en base64url son 43 caracteres.
const KEY_FORMAT = /^fac_[A-Za-z0-9_-]{43}$/;

export function generateApiKey(): string {
  return KEY_PREFIX + randomBytes(32).toString('base64url');
}

export function hashApiKey(key: string, pepper: string): string {
  return createHmac('sha256', pepper).update(key).digest('hex');
}

// Fragmento que sí se puede mostrar para reconocer una key ("fac_AbCd").
export function keyPreview(key: string): string {
  return key.slice(0, KEY_PREFIX.length + 4);
}

// Descarta de entrada lo que no puede ser una key, sin consultar la base.
export function looksLikeApiKey(value: string): boolean {
  return KEY_FORMAT.test(value);
}
