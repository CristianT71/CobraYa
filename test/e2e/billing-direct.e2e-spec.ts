import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { Customer } from '../../src/customers/customer.entity';
import { Invoice } from '../../src/billing/entities/invoice.entity';
import { Payment } from '../../src/billing/entities/payment.entity';
import { Receipt } from '../../src/billing/entities/receipt.entity';
import {
  api,
  createTestApp,
  describeWithDb,
  resetDatabase,
} from './support/test-app';

// Camino directo /billing/* (sin IA) sobre la aplicación completa, con
// PostgreSQL real: contrato HTTP de la sección 7, códigos de la 7.5 e idempotencia
// de la 7.6.

const NO_UUID = '00000000-0000-4000-8000-000000000000';

const invoiceBody = (overrides: Record<string, unknown> = {}) => ({
  customer: { document_type: 'CC', document_number: '1032456789' },
  items: [
    { description: 'Cambio de aceite', quantity: 1, unit_price: '80000.00' },
    { description: 'Filtro', quantity: 1, unit_price: '25000.00' },
  ],
  ...overrides,
});

describeWithDb('Camino directo /billing/* (e2e con PostgreSQL)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let keyCounter = 0;
  const nextKey = () => `e2e-billing-${Date.now()}-${keyCounter++}`;

  const http = () => api(app as never);
  const count = (entity: new () => unknown) =>
    dataSource.getRepository(entity).count();

  const createInvoice = (body: object, key = nextKey()) =>
    http().post('/billing/invoices', key).send(body);

  const pendingInvoice = async () => {
    const res = await createInvoice(invoiceBody()).expect(201);
    return res.body as { invoice_id: string; total: string };
  };

  beforeAll(async () => {
    app = await createTestApp();
    dataSource = app.get(DataSource);
    await dataSource
      .createQueryBuilder()
      .insert()
      .into(Customer)
      .values([
        {
          documentType: 'CC',
          documentNumber: '1032456789',
          fullName: 'Cliente de ejemplo',
        },
        {
          documentType: 'CE',
          documentNumber: '4567890',
          fullName: 'Cliente Extranjero de Prueba',
        },
        {
          documentType: 'CC',
          documentNumber: '4567890',
          fullName: 'Cliente Ambiguo de Prueba',
        },
      ])
      .orIgnore()
      .execute();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase(app);
  });

  describe('POST /billing/invoices', () => {
    it('crea la cuenta pagada con los totales de la sección 7.4 y 201', async () => {
      const res = await createInvoice(
        invoiceBody({ payment: { method: 'cash' } }),
      ).expect(201);

      expect(res.body).toMatchObject({
        customer: {
          document_number: '****6789',
          full_name: 'Cliente de ejemplo',
        },
        subtotal: '105000.00',
        tax_rate: '0.1900',
        tax_amount: '19950.00',
        total: '124950.00',
        payment: { method: 'cash', amount: '124950.00', status: 'APPLIED' },
        receipt: { receipt_number: 1 },
      });
      expect(res.body.request_id).toEqual(expect.any(String));
      expect(JSON.stringify(res.body)).not.toContain('1032456789');
      expect(await count(Receipt)).toBe(1);

      const [invoice] = await dataSource.getRepository(Invoice).find();
      expect(invoice.source).toBe('direct');
    });

    it('sin pago la cuenta queda pendiente, sin comprobante', async () => {
      const res = await createInvoice(invoiceBody()).expect(201);

      expect(res.body.payment).toBeNull();
      expect(res.body.receipt).toBeNull();
      expect(await count(Payment)).toBe(0);
    });

    it('guarda external_ref cuando viene', async () => {
      await createInvoice(invoiceBody({ external_ref: 'OT-2026-118' })).expect(
        201,
      );

      const [invoice] = await dataSource.getRepository(Invoice).find();
      expect(invoice.externalRef).toBe('OT-2026-118');
    });

    describe('idempotencia (sección 7.6)', () => {
      it('misma clave y mismo cuerpo devuelve el original sin duplicar nada', async () => {
        const key = nextKey();
        const body = invoiceBody({ payment: { method: 'card' } });

        const first = await createInvoice(body, key).expect(201);
        const repeated = await createInvoice(body, key).expect(201);

        expect(repeated.body.invoice_id).toBe(first.body.invoice_id);
        expect(repeated.body.receipt).toEqual(first.body.receipt);
        expect(await count(Invoice)).toBe(1);
        expect(await count(Payment)).toBe(1);
        expect(await count(Receipt)).toBe(1);
      });

      it('misma clave con un cuerpo distinto responde 409', async () => {
        const key = nextKey();
        await createInvoice(invoiceBody(), key).expect(201);

        const res = await createInvoice(
          invoiceBody({
            items: [{ description: 'Otro', quantity: 1, unit_price: '1.00' }],
          }),
          key,
        ).expect(409);

        expect(res.body).toMatchObject({
          status: 'rejected',
          data: { error_code: 'IDEMPOTENCY_CONFLICT' },
        });
        expect(await count(Invoice)).toBe(1);
      });

      it('dos peticiones simultáneas con la misma clave crean una sola cuenta', async () => {
        const key = nextKey();
        const body = invoiceBody({ payment: { method: 'cash' } });

        const [a, b] = await Promise.all([
          createInvoice(body, key),
          createInvoice(body, key),
        ]);

        expect([a.status, b.status]).toEqual([201, 201]);
        expect(a.body.invoice_id).toBe(b.body.invoice_id);
        expect(await count(Invoice)).toBe(1);
        expect(await count(Receipt)).toBe(1);
      });
    });

    describe('reglas de negocio: 422 rejected / needs_clarification', () => {
      it('cliente inexistente (RN-01)', async () => {
        const res = await createInvoice(
          invoiceBody({
            customer: { document_type: 'CC', document_number: '999999999' },
          }),
        ).expect(422);

        expect(res.body).toMatchObject({
          status: 'rejected',
          data: { error_code: 'CUSTOMER_NOT_FOUND' },
        });
        expect(await count(Invoice)).toBe(0);
      });

      it('número de documento repetido sin tipo pide el tipo (RN-02)', async () => {
        const res = await createInvoice(
          invoiceBody({ customer: { document_number: '4567890' } }),
        ).expect(422);

        expect(res.body).toMatchObject({
          status: 'needs_clarification',
          data: null,
          missing_fields: ['customer.document_type'],
        });
      });

      it('con el tipo de documento desambigua el mismo número', async () => {
        await createInvoice(
          invoiceBody({
            customer: { document_type: 'CE', document_number: '4567890' },
          }),
        ).expect(201);
      });

      it('total sobre MAX_INVOICE_TOTAL (RN-04)', async () => {
        const res = await createInvoice(
          invoiceBody({
            items: [
              { description: 'Motor', quantity: 1, unit_price: '50000000.00' },
            ],
          }),
        ).expect(422);

        expect(res.body.data).toEqual({ error_code: 'TOTAL_EXCEEDS_LIMIT' });
        expect(await count(Invoice)).toBe(0);
      });

      it('pago distinto del total (RN-06)', async () => {
        const res = await createInvoice(
          invoiceBody({ payment: { method: 'cash', amount: '1000.00' } }),
        ).expect(422);

        expect(res.body.data).toEqual({ error_code: 'PAYMENT_MISMATCH' });
        expect(await count(Invoice)).toBe(0);
      });
    });

    describe('validación de la entrada: 400', () => {
      it('sin Idempotency-Key', async () => {
        await http().post('/billing/invoices').send(invoiceBody()).expect(400);
      });

      it.each([
        ['sin ítems', invoiceBody({ items: [] })],
        ['sin cliente', { items: invoiceBody().items }],
        ['campo no declarado', invoiceBody({ total: '1.00' })],
        [
          'valor unitario con formato inválido',
          invoiceBody({
            items: [{ description: 'x', quantity: 1, unit_price: '80.000' }],
          }),
        ],
        [
          'cantidad cero',
          invoiceBody({
            items: [{ description: 'x', quantity: 0, unit_price: '1.00' }],
          }),
        ],
        [
          'método de pago desconocido',
          invoiceBody({ payment: { method: 'bitcoin' } }),
        ],
        [
          'documento con letras',
          invoiceBody({ customer: { document_number: '12ab' } }),
        ],
      ])('%s', async (_name, body) => {
        const res = await createInvoice(body).expect(400);
        expect(res.body.status).toBe('rejected');
        expect(await count(Invoice)).toBe(0);
      });
    });
  });

  describe('POST /billing/invoices/:id/payments', () => {
    const pay = (
      id: string,
      body: object = { method: 'transfer' },
      key = nextKey(),
    ) => http().post(`/billing/invoices/${id}/payments`, key).send(body);

    it('paga la cuenta pendiente: PAID, comprobante y 201', async () => {
      const pending = await pendingInvoice();

      const res = await pay(pending.invoice_id).expect(201);

      expect(res.body).toMatchObject({
        invoice_id: pending.invoice_id,
        payment: {
          method: 'transfer',
          amount: pending.total,
          status: 'APPLIED',
        },
        receipt: { receipt_number: 1 },
      });
    });

    describe('idempotencia (sección 7.6)', () => {
      it('repetir el mismo pago devuelve el original sin duplicar nada', async () => {
        const pending = await pendingInvoice();
        const key = nextKey();

        const first = await pay(
          pending.invoice_id,
          { method: 'card' },
          key,
        ).expect(201);
        const repeated = await pay(
          pending.invoice_id,
          { method: 'card' },
          key,
        ).expect(201);

        // request_id cambia en cada petición; el resto debe ser idéntico.
        const { request_id: _a, ...original } = first.body;
        const { request_id: _b, ...replayed } = repeated.body;
        expect(replayed).toEqual(original);
        expect(await count(Payment)).toBe(1);
        expect(await count(Receipt)).toBe(1);
      });

      it('la misma clave con otro método responde 409', async () => {
        const pending = await pendingInvoice();
        const key = nextKey();
        await pay(pending.invoice_id, { method: 'card' }, key).expect(201);

        const res = await pay(
          pending.invoice_id,
          { method: 'cash' },
          key,
        ).expect(409);

        expect(res.body.data).toEqual({ error_code: 'IDEMPOTENCY_CONFLICT' });
        expect(await count(Payment)).toBe(1);
      });

      it('una clave nueva sobre la cuenta ya pagada responde 422 INVOICE_NOT_PAYABLE', async () => {
        const pending = await pendingInvoice();
        await pay(pending.invoice_id).expect(201);

        const res = await pay(pending.invoice_id).expect(422);

        expect(res.body).toMatchObject({
          status: 'rejected',
          data: { error_code: 'INVOICE_NOT_PAYABLE' },
        });
        expect(await count(Payment)).toBe(1);
      });
    });

    it('monto distinto del total: 422 PAYMENT_MISMATCH y la cuenta sigue pendiente', async () => {
      const pending = await pendingInvoice();

      const res = await pay(pending.invoice_id, {
        method: 'cash',
        amount: '1.00',
      }).expect(422);

      expect(res.body.data).toEqual({ error_code: 'PAYMENT_MISMATCH' });
      expect(await count(Payment)).toBe(0);
    });

    it('cuenta inexistente: 404 INVOICE_NOT_FOUND', async () => {
      const res = await pay(NO_UUID).expect(404);
      expect(res.body.data).toEqual({ error_code: 'INVOICE_NOT_FOUND' });
    });

    it.each([
      ['id que no es uuid', () => pay('no-es-uuid')],
      [
        'sin Idempotency-Key',
        async () => {
          const pending = await pendingInvoice();
          return http()
            .post(`/billing/invoices/${pending.invoice_id}/payments`)
            .send({ method: 'cash' });
        },
      ],
      [
        'método inválido',
        async () => {
          const pending = await pendingInvoice();
          return pay(pending.invoice_id, { method: 'bitcoin' });
        },
      ],
    ])('%s: 400', async (_name, send) => {
      const res = await send();
      expect(res.status).toBe(400);
    });
  });

  describe('GET /billing/invoices/:id y /billing/receipts/:receiptNumber', () => {
    it('consulta una cuenta con ítems, totales y pagos', async () => {
      const created = await createInvoice(
        invoiceBody({ payment: { method: 'cash' } }),
      ).expect(201);

      const res = await http()
        .get(`/billing/invoices/${created.body.invoice_id}`)
        .expect(200);

      expect(res.body).toMatchObject({
        invoice_id: created.body.invoice_id,
        total: '124950.00',
        payment: { method: 'cash' },
      });
      expect(res.body.items).toHaveLength(2);
    });

    it('consulta un comprobante emitido', async () => {
      const created = await createInvoice(
        invoiceBody({ payment: { method: 'cash' } }),
      ).expect(201);

      const res = await http().get('/billing/receipts/1').expect(200);

      expect(res.body.invoice_id).toBe(created.body.invoice_id);
      expect(res.body.receipt.receipt_number).toBe(1);
    });

    it.each([
      [
        'cuenta inexistente',
        `/billing/invoices/${NO_UUID}`,
        'INVOICE_NOT_FOUND',
      ],
      ['comprobante inexistente', '/billing/receipts/999', 'RECEIPT_NOT_FOUND'],
    ])('%s: 404', async (_name, path, code) => {
      const res = await http().get(path).expect(404);
      expect(res.body).toMatchObject({
        status: 'rejected',
        data: { error_code: code },
      });
    });

    it.each([
      ['/billing/invoices/no-es-uuid'],
      ['/billing/receipts/abc'],
      ['/billing/receipts/0'],
    ])('%s: 400', async (path) => {
      await http().get(path).expect(400);
    });
  });

  describe('seguridad y operación', () => {
    it.each([
      ['POST', '/billing/invoices'],
      ['GET', `/billing/invoices/${NO_UUID}`],
      ['GET', '/billing/receipts/1'],
    ])('%s %s sin X-API-Key responde 401', async (method, path) => {
      const server = app.getHttpServer();
      const req =
        method === 'POST'
          ? request(server).post(path)
          : request(server).get(path);
      const res = await req.expect(401);
      expect(res.body.status).toBe('rejected');
    });

    it('GET /health es público y confirma la conexión a PostgreSQL', async () => {
      const res = await request(app.getHttpServer()).get('/health').expect(200);
      expect(res.body).toMatchObject({ status: 'ok', database: 'up' });
    });

    it('Swagger documenta todos los endpoints de la sección 7 y los del canal de negocios', () => {
      const document = SwaggerModule.createDocument(
        app,
        new DocumentBuilder().build(),
      );

      expect(Object.keys(document.paths).sort()).toEqual(
        [
          '/.well-known/agent.json',
          '/a2a/tasks',
          '/admin/partners',
          '/admin/partners/{id}',
          '/admin/partners/{id}/exchanges',
          '/admin/partners/{id}/rotate-key',
          '/agent/requests',
          '/billing/invoices',
          '/billing/invoices/{id}',
          '/billing/invoices/{id}/payments',
          '/billing/receipts/{receiptNumber}',
          '/health',
          '/public/info',
          '/public/receipts/verify',
        ].sort(),
      );
      expect(document.paths['/agent/requests']).toHaveProperty('post');
      expect(document.paths['/billing/invoices']).toHaveProperty('post');
      expect(document.paths['/billing/invoices/{id}/payments']).toHaveProperty(
        'post',
      );
      expect(document.paths['/billing/invoices/{id}']).toHaveProperty('get');
      expect(
        document.paths['/billing/receipts/{receiptNumber}'],
      ).toHaveProperty('get');
      expect(document.paths['/health']).toHaveProperty('get');
      expect(document.paths['/a2a/tasks']).toHaveProperty('post');
      expect(document.paths['/.well-known/agent.json']).toHaveProperty('get');
    });
  });
});
