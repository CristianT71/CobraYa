import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { PARTNER_SKILLS } from '../../src/partners/skills';
import {
  api,
  createTestApp,
  describeWithDb,
  resetDatabase,
} from './support/test-app';

// Administración de negocios: solo el operador (clave de servicio) registra, cambia,
// desactiva y rota keys. La key de un negocio nunca abre estas rutas.

const NO_UUID = '00000000-0000-4000-8000-000000000000';

describeWithDb('Administración de negocios (e2e con PostgreSQL)', () => {
  let app: INestApplication;
  let dataSource: DataSource;

  const admin = () => api(app as never);
  const send = (method: 'post' | 'patch', path: string, body: object = {}) => {
    const req = request(app.getHttpServer())
      [method](path)
      .set('X-API-Key', 'e2e-api-key');
    return req.send(body);
  };
  const callA2a = (key: string) =>
    request(app.getHttpServer())
      .post('/a2a/tasks')
      .set('Authorization', `Bearer ${key}`)
      .send({ skill: 'consultar_cuenta', params: { invoice_id: NO_UUID } });

  const createPartner = (body: object = {}) =>
    send('post', '/admin/partners', {
      slug: 'concesionario',
      name: 'AutoMax Concesionario',
      ...body,
    });

  beforeAll(async () => {
    app = await createTestApp();
    dataSource = app.get(DataSource);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase(app);
    await dataSource.query('DELETE FROM partner_exchanges');
    await dataSource.query(
      'DELETE FROM customers WHERE partner_id IS NOT NULL',
    );
    await dataSource.query('DELETE FROM partners');
  });

  describe('acceso', () => {
    it.each([
      ['GET', '/admin/partners'],
      ['POST', '/admin/partners'],
      ['PATCH', `/admin/partners/${NO_UUID}`],
      ['POST', `/admin/partners/${NO_UUID}/rotate-key`],
      ['GET', `/admin/partners/${NO_UUID}/exchanges`],
    ])('%s %s sin la clave de servicio responde 401', async (method, path) => {
      const server = app.getHttpServer();
      const req =
        method === 'GET'
          ? request(server).get(path)
          : method === 'POST'
            ? request(server).post(path)
            : request(server).patch(path);

      await req.expect(401);
    });

    it('la key de un negocio no abre la administración', async () => {
      const { api_key: key } = (await createPartner().expect(201)).body;

      await request(app.getHttpServer())
        .get('/admin/partners')
        .set('X-API-Key', key)
        .expect(401);
      await request(app.getHttpServer())
        .get('/admin/partners')
        .set('Authorization', `Bearer ${key}`)
        .expect(401);
    });
  });

  describe('POST /admin/partners', () => {
    it('registra el negocio y devuelve su key una sola vez', async () => {
      const res = await createPartner().expect(201);

      expect(res.body.api_key).toMatch(/^fac_[A-Za-z0-9_-]{43}$/);
      expect(res.body.warning).toContain('no se vuelve a mostrar');
      expect(res.body.partner).toMatchObject({
        slug: 'concesionario',
        name: 'AutoMax Concesionario',
        active: true,
        skills: [...PARTNER_SKILLS],
        rate_per_minute: 30,
        daily_quota: 500,
        key_prefix: res.body.api_key.slice(0, 8),
      });
    });

    it('la key recién creada ya funciona en /a2a/tasks', async () => {
      const { api_key: key } = (await createPartner().expect(201)).body;

      await callA2a(key).expect(200);
    });

    it('acepta permisos y límites propios', async () => {
      const res = await createPartner({
        skills: ['consultar_cuenta', 'consultar_comprobante'],
        rate_per_minute: 5,
        daily_quota: 20,
      }).expect(201);

      expect(res.body.partner).toMatchObject({
        skills: ['consultar_cuenta', 'consultar_comprobante'],
        rate_per_minute: 5,
        daily_quota: 20,
      });
    });

    it('recorta los espacios del nombre', async () => {
      const res = await createPartner({ name: '  Taller Falla  ' }).expect(201);

      expect(res.body.partner.name).toBe('Taller Falla');
    });

    it('un identificador repetido responde 409 PARTNER_EXISTS', async () => {
      await createPartner().expect(201);

      const res = await createPartner({ name: 'Otro' }).expect(409);

      expect(res.body).toMatchObject({
        status: 'rejected',
        data: { error_code: 'PARTNER_EXISTS' },
      });
    });

    it.each([
      ['slug con mayúsculas', { slug: 'Concesionario' }],
      ['slug con espacios', { slug: 'mi negocio' }],
      ['slug con guion bajo', { slug: 'mi_negocio' }],
      ['slug que empieza con dígito', { slug: '1taller' }],
      ['slug de un carácter', { slug: 'a' }],
      ['slug de más de 20 caracteres', { slug: 'a'.repeat(21) }],
      ['nombre de un carácter', { name: 'A' }],
      ['nombre de más de 80 caracteres', { name: 'a'.repeat(81) }],
      ['habilidad desconocida', { skills: ['borrar_todo'] }],
      ['habilidades repetidas', { skills: ['crear_cuenta', 'crear_cuenta'] }],
      ['límite por minuto de 0', { rate_per_minute: 0 }],
      ['límite por minuto de 601', { rate_per_minute: 601 }],
      ['cuota diaria de 0', { daily_quota: 0 }],
      ['cuota diaria de 100001', { daily_quota: 100_001 }],
      ['límite decimal', { rate_per_minute: 1.5 }],
      ['campo no declarado', { active: false }],
      [
        'key enviada por quien administra',
        { api_key: `fac_${'a'.repeat(43)}` },
      ],
    ])('rechaza %s con 400', async (_name, extra) => {
      const res = await createPartner(extra).expect(400);

      expect(res.body.status).toBe('rejected');
      expect(await dataSource.query('SELECT 1 FROM partners')).toHaveLength(0);
    });
  });

  describe('GET /admin/partners', () => {
    it('lista los negocios sin keys ni hashes', async () => {
      const first = (await createPartner().expect(201)).body;
      await createPartner({ slug: 'taller', name: 'Taller' }).expect(201);

      const res = await admin().get('/admin/partners').expect(200);

      expect(res.body.map((p: { slug: string }) => p.slug)).toEqual([
        'concesionario',
        'taller',
      ]);
      const text = JSON.stringify(res.body);
      expect(text).not.toContain(first.api_key);
      expect(text).not.toMatch(/key_hash|fac_[A-Za-z0-9_-]{43}/);
    });
  });

  describe('PATCH /admin/partners/:id', () => {
    it('cambia nombre, permisos y límites sin tocar la key', async () => {
      const created = (await createPartner().expect(201)).body;

      const res = await send('patch', `/admin/partners/${created.partner.id}`, {
        name: 'AutoMax S.A.S.',
        skills: ['crear_cuenta'],
        rate_per_minute: 10,
        daily_quota: 100,
      }).expect(200);

      expect(res.body).toMatchObject({
        name: 'AutoMax S.A.S.',
        skills: ['crear_cuenta'],
        rate_per_minute: 10,
        daily_quota: 100,
        slug: 'concesionario',
      });
      await callA2a(created.api_key).expect(403);
    });

    it('desactivar al negocio deja su key sin servir en el acto, y reactivarlo la devuelve', async () => {
      const created = (await createPartner().expect(201)).body;
      await callA2a(created.api_key).expect(200);

      await send('patch', `/admin/partners/${created.partner.id}`, {
        active: false,
      }).expect(200);
      await callA2a(created.api_key).expect(401);

      await send('patch', `/admin/partners/${created.partner.id}`, {
        active: true,
      }).expect(200);
      await callA2a(created.api_key).expect(200);
    });

    it('no permite cambiar el identificador', async () => {
      const created = (await createPartner().expect(201)).body;

      await send('patch', `/admin/partners/${created.partner.id}`, {
        slug: 'otro',
      }).expect(400);
    });

    it.each([
      ['límite fuera de rango', { rate_per_minute: 0 }],
      ['habilidad desconocida', { skills: ['x'] }],
      ['active que no es booleano', { active: 'no' }],
    ])('rechaza %s con 400', async (_name, body) => {
      const created = (await createPartner().expect(201)).body;

      await send('patch', `/admin/partners/${created.partner.id}`, body).expect(
        400,
      );
    });

    it.each([
      ['un uuid que no existe', NO_UUID],
      ['algo que no es uuid', 'no-es-uuid'],
    ])('responde 404 PARTNER_NOT_FOUND con %s', async (_name, id) => {
      const res = await send('patch', `/admin/partners/${id}`, {
        active: false,
      }).expect(404);

      expect(res.body.data.error_code).toBe('PARTNER_NOT_FOUND');
    });
  });

  describe('POST /admin/partners/:id/rotate-key', () => {
    it('entrega una key nueva y la anterior deja de servir en el acto', async () => {
      const created = (await createPartner().expect(201)).body;

      const res = await send(
        'post',
        `/admin/partners/${created.partner.id}/rotate-key`,
      ).expect(200);

      expect(res.body.api_key).not.toBe(created.api_key);
      expect(res.body.partner.key_prefix).toBe(res.body.api_key.slice(0, 8));
      await callA2a(created.api_key).expect(401);
      await callA2a(res.body.api_key).expect(200);
    });

    it('responde 404 si el negocio no existe', async () => {
      await send('post', `/admin/partners/${NO_UUID}/rotate-key`).expect(404);
    });
  });

  describe('GET /admin/partners/:id/exchanges', () => {
    const wait = () => new Promise((resolve) => setTimeout(resolve, 150));

    it('muestra los intercambios del negocio, del más reciente al más antiguo', async () => {
      const created = (await createPartner().expect(201)).body;
      await callA2a(created.api_key).expect(200);
      await request(app.getHttpServer())
        .post('/a2a/tasks')
        .set('Authorization', `Bearer ${created.api_key}`)
        .send({ skill: 'consultar_comprobante', params: { receipt_number: 5 } })
        .expect(200);
      await wait();

      const res = await admin()
        .get(`/admin/partners/${created.partner.id}/exchanges`)
        .expect(200);

      expect(res.body.map((e: { skill: string }) => e.skill)).toEqual([
        'consultar_comprobante',
        'consultar_cuenta',
      ]);
      expect(res.body[0]).toMatchObject({
        status: 'rejected',
        error_code: 'RECEIPT_NOT_FOUND',
        http_status: 200,
      });
    });

    it('respeta el parámetro limit', async () => {
      const created = (await createPartner().expect(201)).body;
      for (let i = 0; i < 3; i++) await callA2a(created.api_key).expect(200);
      await wait();

      const res = await admin()
        .get(`/admin/partners/${created.partner.id}/exchanges?limit=2`)
        .expect(200);

      expect(res.body).toHaveLength(2);
    });

    it.each(['0', '201', 'abc', '1.5'])(
      'rechaza limit=%s con 400',
      async (limit) => {
        const created = (await createPartner().expect(201)).body;

        await admin()
          .get(`/admin/partners/${created.partner.id}/exchanges?limit=${limit}`)
          .expect(400);
      },
    );

    it('no mezcla los intercambios de un negocio con los de otro', async () => {
      const a = (await createPartner().expect(201)).body;
      const b = (
        await createPartner({ slug: 'taller', name: 'Taller' }).expect(201)
      ).body;
      await callA2a(a.api_key).expect(200);
      await wait();

      const own = await admin()
        .get(`/admin/partners/${a.partner.id}/exchanges`)
        .expect(200);
      const other = await admin()
        .get(`/admin/partners/${b.partner.id}/exchanges`)
        .expect(200);

      expect(own.body).toHaveLength(1);
      expect(other.body).toHaveLength(0);
    });

    it('responde 404 si el negocio no existe', async () => {
      await admin().get(`/admin/partners/${NO_UUID}/exchanges`).expect(404);
    });
  });
});
