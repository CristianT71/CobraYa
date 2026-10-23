import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Controller, Get, type INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PAGE_CSP, frontendDir, serveFrontend } from '../../src/frontend.setup';

@Controller('ping')
class PingController {
  @Get()
  ping() {
    return { ok: true };
  }
}

describe('serveFrontend', () => {
  let root: string;
  let dist: string;
  let app: INestApplication | undefined;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'facturacion-page-'));
    dist = join(root, 'dist');
    mkdirSync(join(dist, 'assets'), { recursive: true });
    writeFileSync(
      join(dist, 'index.html'),
      '<!doctype html><title>Pagina</title>',
    );
    writeFileSync(
      join(dist, 'favicon.svg'),
      '<svg xmlns="http://www.w3.org/2000/svg"/>',
    );
    writeFileSync(join(dist, 'assets', 'index-abc123.js'), 'console.log("ok")');
    // Fuera de la carpeta publicada: nunca debe poder leerse.
    writeFileSync(join(root, 'secreto.txt'), 'CONTENIDO-SECRETO');
  });

  afterEach(async () => {
    await app?.close();
    app = undefined;
    rmSync(root, { recursive: true, force: true });
  });

  async function start(directory = dist): Promise<{ mounted: boolean }> {
    const moduleRef = await Test.createTestingModule({
      controllers: [PingController],
    }).compile();
    const nest = moduleRef.createNestApplication<NestExpressApplication>({
      logger: false,
    });
    const mounted = serveFrontend(nest, directory);
    await nest.init();
    app = nest;
    return { mounted };
  }

  it('sirve la página en la raíz', async () => {
    const { mounted } = await start();

    const res = await request(app!.getHttpServer()).get('/').expect(200);

    expect(mounted).toBe(true);
    expect(res.text).toContain('<title>Pagina</title>');
  });

  it('el HTML lleva la política de seguridad, no se puede incrustar y se revalida', async () => {
    await start();

    const res = await request(app!.getHttpServer())
      .get('/index.html')
      .expect(200);

    expect(res.headers['content-security-policy']).toBe(PAGE_CSP);
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['cache-control']).toBe('no-cache');
  });

  it('la política no permite scripts ni estilos en línea, ni eval, ni recursos externos', () => {
    expect(PAGE_CSP).not.toMatch(/unsafe-inline|unsafe-eval|https?:|\*/);
    expect(PAGE_CSP).toContain("script-src 'self'");
    expect(PAGE_CSP).toContain("frame-ancestors 'none'");
    expect(PAGE_CSP).toContain("object-src 'none'");
  });

  it('los archivos de /assets se guardan un año porque su nombre lleva el hash', async () => {
    await start();

    const res = await request(app!.getHttpServer())
      .get('/assets/index-abc123.js')
      .expect(200);

    expect(res.headers['cache-control']).toBe(
      'public, max-age=31536000, immutable',
    );
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toBeUndefined();
  });

  it('otros archivos (el ícono) no se marcan como inmutables', async () => {
    await start();

    const res = await request(app!.getHttpServer())
      .get('/favicon.svg')
      .expect(200);

    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['cache-control']).not.toContain('immutable');
  });

  it('las rutas de la API siguen funcionando con la página montada', async () => {
    await start();

    const res = await request(app!.getHttpServer()).get('/ping').expect(200);

    expect(res.body).toEqual({ ok: true });
  });

  it('una ruta que no existe llega a Nest y responde 404, no la página', async () => {
    await start();

    const res = await request(app!.getHttpServer())
      .get('/no-existe')
      .expect(404);

    expect(res.text).not.toContain('<title>Pagina</title>');
  });

  it.each([
    '/../secreto.txt',
    '/%2e%2e/secreto.txt',
    '/..%2fsecreto.txt',
    '/assets/../../secreto.txt',
    '/%2e%2e%2fsecreto.txt',
  ])('no deja salir de la carpeta publicada: %s', async (path) => {
    await start();

    const res = await request(app!.getHttpServer()).get(path);

    expect(res.status).not.toBe(200);
    expect(res.text).not.toContain('CONTENIDO-SECRETO');
  });

  it('si la página no está compilada no monta nada y el servicio sigue siendo una API', async () => {
    const { mounted } = await start(join(root, 'no-existe'));

    expect(mounted).toBe(false);
    await request(app!.getHttpServer()).get('/').expect(404);
    await request(app!.getHttpServer()).get('/ping').expect(200);
  });

  it('frontendDir usa FRONTEND_DIST si está definida', () => {
    const previous = process.env.FRONTEND_DIST;
    process.env.FRONTEND_DIST = '/otra/carpeta';
    try {
      expect(frontendDir()).toBe('/otra/carpeta');
    } finally {
      if (previous === undefined) delete process.env.FRONTEND_DIST;
      else process.env.FRONTEND_DIST = previous;
    }
  });

  it('por defecto apunta a frontend/dist junto al proyecto', () => {
    const previous = process.env.FRONTEND_DIST;
    delete process.env.FRONTEND_DIST;
    try {
      expect(frontendDir().replace(/\\/g, '/')).toMatch(/\/frontend\/dist$/);
    } finally {
      if (previous !== undefined) process.env.FRONTEND_DIST = previous;
    }
  });
});
