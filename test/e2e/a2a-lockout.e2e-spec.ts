import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { PartnersService } from '../../src/partners/partners.service';
import { createTestApp, describeWithDb } from './support/test-app';

// Bloqueo por intentos fallidos con key inválida. Va en su propio archivo (y por
// tanto con su propia aplicación): bloquea la IP de la prueba durante 15 minutos
// y no debe afectar a las demás suites.

describeWithDb('A2A: bloqueo por intentos con key inválida (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let validKey: string;

  const send = (key: string) =>
    request(app.getHttpServer())
      .post('/a2a/tasks')
      .set('Authorization', `Bearer ${key}`)
      .send({
        skill: 'consultar_cuenta',
        params: { invoice_id: '00000000-0000-4000-8000-000000000000' },
      });

  beforeAll(async () => {
    app = await createTestApp();
    dataSource = app.get(DataSource);
    await dataSource.query('DELETE FROM partner_exchanges');
    await dataSource.query(
      'DELETE FROM customers WHERE partner_id IS NOT NULL',
    );
    await dataSource.query('DELETE FROM partners');
    validKey = (
      await app
        .get(PartnersService)
        .create({ slug: 'lockout', name: 'Negocio de prueba' })
    ).apiKey;
  });

  afterAll(async () => {
    await dataSource.query('DELETE FROM partner_exchanges');
    await dataSource.query('DELETE FROM partners');
    await app.close();
  });

  it('tras 10 intentos con keys falsas bloquea la IP con 429 y Retry-After', async () => {
    for (let i = 0; i < 10; i++) {
      await send(`fac_${String(i).padStart(43, 'x')}`).expect(401);
    }

    const blocked = await send(`fac_${'q'.repeat(43)}`).expect(429);

    expect(blocked.body).toMatchObject({
      status: 'rejected',
      data: { error_code: 'RATE_LIMITED' },
    });
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('con la IP bloqueada, ni siquiera una key válida entra', async () => {
    const res = await send(validKey).expect(429);

    expect(res.body.data.error_code).toBe('RATE_LIMITED');
  });
});
