import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { PartnersService } from '../../src/partners/partners.service';
import { PARTNER_SKILLS } from '../../src/partners/skills';
import {
  api,
  createTestApp,
  describeWithDb,
  resetDatabase,
} from './support/test-app';

// Endpoints públicos de la página web: la información del servicio y la verificación
// de comprobantes. No llevan key, pero no exponen datos sensibles ni dejan sondear.

const DOC = '1032456789';

describeWithDb('Endpoints públicos (e2e con PostgreSQL)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let partnerKey: string;
  let counter = 0;
  const nextKey = () => `e2e-public-${Date.now()}-${counter++}`;

  const a2a = (body: object) =>
    request(app.getHttpServer())
      .post('/a2a/tasks')
      .set('Authorization', `Bearer ${partnerKey}`)
      .set('Idempotency-Key', nextKey())
      .send(body);

  const verify = (body: object) =>
    request(app.getHttpServer()).post('/public/receipts/verify').send(body);

  // Un comprobante del negocio "concesionario" para el cliente DOC.
  const paidInvoiceByPartner = async () => {
    await a2a({
      skill: 'registrar_cliente',
      params: {
        document_type: 'CC',
        document_number: DOC,
        full_name: 'Ana Pérez Secreta',
      },
    }).expect(200);
    const res = await a2a({
      skill: 'crear_cuenta',
      params: {
        customer: { document_type: 'CC', document_number: DOC },
        items: [
          {
            description: 'Cambio de aceite',
            quantity: 1,
            unit_price: '80000.00',
          },
          { description: 'Filtro', quantity: 1, unit_price: '25000.00' },
        ],
        payment: { method: 'cash' },
      },
    }).expect(200);
    return res.body.data.receipt.receipt_number as number;
  };

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
    partnerKey = (
      await app
        .get(PartnersService)
        .create({ slug: 'concesionario', name: 'AutoMax Concesionario' })
    ).apiKey;
  });

  describe('GET /public/info', () => {
    it('es público y describe el servicio, su alcance y sus habilidades', async () => {
      const res = await request(app.getHttpServer())
        .get('/public/info')
        .expect(200);

      expect(res.body).toMatchObject({
        name: 'Facturación y Pagos',
        a2a: {
          card_url: expect.stringMatching(/\/\.well-known\/agent\.json$/),
          tasks_url: expect.stringMatching(/\/a2a\/tasks$/),
        },
        docs_url: expect.stringMatching(/\/docs$/),
      });
      expect(res.body.skills.map((s: { id: string }) => s.id)).toEqual([
        ...PARTNER_SKILLS,
      ]);
      expect(res.body.scope.does_not.join(' ')).toMatch(/contabilidad/i);
    });

    it('no expone claves, configuración interna ni datos de negocios', async () => {
      const res = await request(app.getHttpServer())
        .get('/public/info')
        .expect(200);

      const text = JSON.stringify(res.body);
      expect(text).not.toContain(partnerKey);
      expect(text).not.toContain('e2e-api-key');
      expect(text).not.toContain('concesionario');
      expect(text).not.toMatch(/postgres|pepper|fireworks/i);
    });
  });

  describe('POST /public/receipts/verify', () => {
    it('verifica un comprobante con su número y el documento del cliente', async () => {
      const number = await paidInvoiceByPartner();

      const res = await verify({
        receipt_number: number,
        document_number: DOC,
      }).expect(200);

      expect(res.body).toMatchObject({
        receipt_number: number,
        issued_by: 'AutoMax Concesionario',
        customer_document: '****6789',
        subtotal: '105000.00',
        tax_amount: '19950.00',
        total: '124950.00',
        payment: { method: 'cash', amount: '124950.00' },
      });
      expect(res.body.items).toEqual([
        {
          description: 'Cambio de aceite',
          quantity: 1,
          line_total: '80000.00',
        },
        { description: 'Filtro', quantity: 1, line_total: '25000.00' },
      ]);
    });

    it('acepta el documento con puntos o espacios', async () => {
      const number = await paidInvoiceByPartner();

      await verify({
        receipt_number: number,
        document_number: '1.032.456.789',
      }).expect(200);
      await verify({
        receipt_number: number,
        document_number: '1032 456 789',
      }).expect(200);
    });

    it('no revela el nombre del cliente ni el documento completo', async () => {
      const number = await paidInvoiceByPartner();

      const res = await verify({
        receipt_number: number,
        document_number: DOC,
      }).expect(200);

      const text = JSON.stringify(res.body);
      expect(text).not.toContain('Ana Pérez');
      expect(text).not.toContain(DOC);
    });

    it('un comprobante de la plataforma se atribuye a "Facturación y Pagos"', async () => {
      const res = await api(app as never)
        .post('/billing/invoices', nextKey())
        .send({
          customer: { document_type: 'CC', document_number: DOC },
          items: [
            { description: 'Filtro', quantity: 1, unit_price: '25000.00' },
          ],
          payment: { method: 'card' },
        })
        .expect(201);

      const verified = await verify({
        receipt_number: res.body.receipt.receipt_number,
        document_number: DOC,
      }).expect(200);

      expect(verified.body.issued_by).toBe('Facturación y Pagos');
    });

    it('un documento equivocado y un número inexistente responden exactamente igual', async () => {
      const number = await paidInvoiceByPartner();

      const wrongDocument = await verify({
        receipt_number: number,
        document_number: '999999999',
      }).expect(404);
      const missingNumber = await verify({
        receipt_number: 424242,
        document_number: DOC,
      }).expect(404);

      const strip = (body: Record<string, unknown>) => ({
        ...body,
        request_id: undefined,
      });
      expect(strip(wrongDocument.body)).toEqual(strip(missingNumber.body));
      expect(wrongDocument.body).toMatchObject({
        status: 'rejected',
        data: { error_code: 'RECEIPT_NOT_FOUND' },
      });
    });

    it('el documento de otro cliente no sirve para ver un comprobante ajeno', async () => {
      const number = await paidInvoiceByPartner();
      await app.get(PartnersService).create({ slug: 'taller', name: 'Taller' });

      await verify({
        receipt_number: number,
        document_number: '777000111',
      }).expect(404);
    });

    it.each([
      ['sin cuerpo', {}],
      ['sin documento', { receipt_number: 1 }],
      ['sin número', { document_number: DOC }],
      ['número cero', { receipt_number: 0, document_number: DOC }],
      ['número negativo', { receipt_number: -3, document_number: DOC }],
      ['número decimal', { receipt_number: 1.5, document_number: DOC }],
      ['número como texto', { receipt_number: '1', document_number: DOC }],
      [
        'documento con letras',
        { receipt_number: 1, document_number: '12AB567' },
      ],
      [
        'documento demasiado corto',
        { receipt_number: 1, document_number: '123' },
      ],
      [
        'campo no declarado',
        { receipt_number: 1, document_number: DOC, admin: true },
      ],
    ])('rechaza %s con 400', async (_name, body) => {
      const res = await verify(body).expect(400);

      expect(res.body.status).toBe('rejected');
    });

    it('no necesita ninguna key y una key cualquiera no cambia el resultado', async () => {
      const number = await paidInvoiceByPartner();

      await request(app.getHttpServer())
        .post('/public/receipts/verify')
        .set('X-API-Key', 'una-clave-cualquiera')
        .send({ receipt_number: number, document_number: DOC })
        .expect(200);
    });
  });
});

// Cada describe levanta su propia aplicación, así que cada uno tiene sus propios
// contadores: el límite por minuto y el bloqueo por fallos no se mezclan.
describeWithDb('Límites de la verificación pública (e2e)', () => {
  let app: INestApplication;
  const verify = (body: object) =>
    request(app.getHttpServer()).post('/public/receipts/verify').send(body);

  beforeEach(async () => {
    app = await createTestApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('tras 10 intentos fallidos bloquea la IP con 429 y Retry-After', async () => {
    for (let i = 1; i <= 10; i++) {
      await verify({
        receipt_number: 900_000 + i,
        document_number: '111111111',
      }).expect(404);
    }

    const blocked = await verify({
      receipt_number: 900_011,
      document_number: '111111111',
    }).expect(429);

    expect(blocked.body.data.error_code).toBe('RATE_LIMITED');
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('limita a 10 consultas por minuto por IP aunque no fallen', async () => {
    // Un comprobante real para que las consultas no cuenten como fallos.
    const ds = app.get(DataSource);
    await resetDatabase(app);
    const rows: Array<{ id: string }> = await ds.query(
      `INSERT INTO invoices (customer_id, status, subtotal, tax_rate, tax_amount, total, idempotency_key, source)
       SELECT id, 'PAID', '100.00', '0.1900', '19.00', '119.00', 'lim-' || gen_random_uuid(), 'direct'
       FROM customers WHERE partner_id IS NULL LIMIT 1 RETURNING id`,
    );
    const customer: Array<{ document_number: string }> = await ds.query(
      `SELECT c.document_number FROM invoices i JOIN customers c ON c.id = i.customer_id WHERE i.id = $1`,
      [rows[0].id],
    );
    const receipt: Array<{ receipt_number: number }> = await ds.query(
      `INSERT INTO receipts (invoice_id, payload) VALUES ($1, '{}'::jsonb) RETURNING receipt_number`,
      [rows[0].id],
    );
    const body = {
      receipt_number: receipt[0].receipt_number,
      document_number: customer[0].document_number,
    };

    for (let i = 0; i < 10; i++) await verify(body).expect(200);
    const limited = await verify(body).expect(429);

    expect(limited.headers['retry-after']).toBeDefined();
  });
});
