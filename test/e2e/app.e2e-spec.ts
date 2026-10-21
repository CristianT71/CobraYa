import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import {
  api,
  createTestApp,
  describeWithDb,
  resetDatabase,
} from './support/test-app';

// Aplicación completa contra PostgreSQL de prueba. Aquí se agregan los flujos de
// /billing/* y /agent/requests (con el MockExtractor) cuando lleguen a main.
describeWithDb('Aplicación completa (e2e con PostgreSQL)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(async () => {
    await resetDatabase(app);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('GET /health confirma la conexión real a PostgreSQL', async () => {
    const res = await request(app.getHttpServer()).get('/health').expect(200);
    expect(res.body).toMatchObject({ status: 'ok', database: 'up' });
  });

  it('las rutas protegidas exigen X-API-Key', async () => {
    await request(app.getHttpServer()).get('/billing/invoices/x').expect(401);
  });

  it('con API key, una ruta inexistente responde 404 con el envoltorio', async () => {
    const res = await api(app).get('/no-existe').expect(404);
    expect(res.body).toMatchObject({
      status: 'rejected',
      data: { error_code: 'NOT_FOUND' },
    });
  });
});
