import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from '../../../src/app.module';
import { configureApp } from '../../../src/app.setup';
import { E2E_API_KEY, E2E_DATABASE_URL } from './setup-env';

/** describe que solo corre si hay base de datos de prueba (E2E_DATABASE_URL). */
export const describeWithDb = E2E_DATABASE_URL ? describe : describe.skip;

export interface ProviderOverride {
  provide: unknown;
  useValue: unknown;
}

// Tablas con datos semilla que se conservan entre pruebas.
// partners y partner_exchanges también se conservan: vaciar partners con CASCADE
// borraría los clientes, que dependen de ella. Cada suite administra sus negocios.
const KEEP_TABLES = new Set(['customers', 'partners', 'partner_exchanges']);

/**
 * Levanta la aplicación completa (AppModule) con la misma configuración global
 * que main.ts. `overrides` reemplaza proveedores; por ejemplo, el puerto del
 * LLM por el MockExtractor:
 *   createTestApp([{ provide: LLM_EXTRACTOR, useValue: mockExtractor }])
 */
export async function createTestApp(
  overrides: ProviderOverride[] = [],
): Promise<INestApplication<App>> {
  let builder = Test.createTestingModule({ imports: [AppModule] });
  for (const o of overrides) {
    builder = builder
      .overrideProvider(o.provide as string)
      .useValue(o.useValue);
  }
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication<INestApplication<App>>({
    logger: false,
  });
  configureApp(app);
  await app.init();
  return app;
}

/** Vacía las tablas de negocio (salvo los clientes semilla) entre pruebas. */
export async function resetDatabase(app: INestApplication): Promise<void> {
  const dataSource = app.get(DataSource);
  const tables = dataSource.entityMetadatas
    .map((m) => m.tableName)
    .filter((t) => !KEEP_TABLES.has(t));
  if (tables.length === 0) return;
  await dataSource.query(
    `TRUNCATE ${tables.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`,
  );
}

/** Petición autenticada con la API key de pruebas. */
export function api(app: INestApplication<App>) {
  const server = app.getHttpServer();
  return {
    get: (path: string) =>
      request(server).get(path).set('X-API-Key', E2E_API_KEY),
    post: (path: string, idempotencyKey?: string) => {
      const req = request(server).post(path).set('X-API-Key', E2E_API_KEY);
      return idempotencyKey ? req.set('Idempotency-Key', idempotencyKey) : req;
    },
  };
}
