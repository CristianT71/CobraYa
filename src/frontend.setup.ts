import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { ServerResponse } from 'node:http';

// Política de seguridad del navegador para la página (solo para ella: Swagger en
// /docs necesita scripts en línea y no pasa por aquí). La página no usa scripts ni
// estilos en línea, ni recursos externos, así que todo es del mismo origen.
export const PAGE_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

// Carpeta de la página compilada (npm run build --prefix frontend). Se puede
// cambiar con FRONTEND_DIST.
export function frontendDir(): string {
  return process.env.FRONTEND_DIST || join(__dirname, '..', 'frontend', 'dist');
}

export function setPageHeaders(res: ServerResponse, filePath: string): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');

  if (filePath.endsWith('.html')) {
    res.setHeader('Content-Security-Policy', PAGE_CSP);
    res.setHeader('X-Frame-Options', 'DENY');
    // La página cambia con cada despliegue: siempre se revalida.
    res.setHeader('Cache-Control', 'no-cache');
  } else if (/[\\/]assets[\\/]/.test(filePath)) {
    // Los archivos de /assets llevan el hash de su contenido en el nombre.
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  }
}

/**
 * Sirve la página web desde el mismo origen que la API. Los archivos estáticos se
 * atienden antes que las rutas de Nest, así que no pasan por el guard de la API key:
 * son públicos y no contienen nada sensible. Devuelve false si la página no está
 * compilada (el servicio arranca igual, solo como API).
 */
export function serveFrontend(
  app: NestExpressApplication,
  dir: string = frontendDir(),
): boolean {
  if (!existsSync(join(dir, 'index.html'))) return false;
  app.useStaticAssets(dir, { index: 'index.html', setHeaders: setPageHeaders });
  return true;
}
