import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { PartnersService } from '../../src/partners/partners.service';
import {
  createTestApp,
  describeWithDb,
  resetDatabase,
} from './support/test-app';

// Comprobante en PDF: lo descarga el negocio emisor con su key, o quien presenta el
// documento del cliente. Un comprobante ajeno responde igual que uno inexistente.

const DOC = '1032456789';

type Binary = { body: Buffer; headers: Record<string, string> };

const binary = (
  res: request.Response,
  done: (error: Error | null, body: Buffer) => void,
) => {
  const chunks: Buffer[] = [];
  res.on('data', (chunk: Buffer) => chunks.push(chunk));
  res.on('end', () => done(null, Buffer.concat(chunks)));
};

describeWithDb('Comprobante en PDF (e2e con PostgreSQL)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let partners: PartnersService;
  let keyA: string;
  let keyB: string;
  let readOnlyKey: string;
  let counter = 0;
  const nextKey = () => `e2e-pdf-${Date.now()}-${counter++}`;

  const a2a = (key: string, body: object) =>
    request(app.getHttpServer())
      .post('/a2a/tasks')
      .set('Authorization', `Bearer ${key}`)
      .set('Idempotency-Key', nextKey())
      .send(body);

  const partnerPdf = (number: number | string, key?: string) => {
    const req = request(app.getHttpServer())
      .get(`/a2a/receipts/${number}/pdf`)
      .buffer(true)
      .parse(binary as never);
    return key ? req.set('Authorization', `Bearer ${key}`) : req;
  };

  const publicPdf = (body: object) =>
    request(app.getHttpServer())
      .post('/public/receipts/pdf')
      .buffer(true)
      .parse(binary as never)
      .send(body);

  // Un comprobante del negocio A para el cliente DOC.
  const receiptOfA = async () => {
    await a2a(keyA, {
      skill: 'registrar_cliente',
      params: {
        document_type: 'CC',
        document_number: DOC,
        full_name: 'Ana Pérez',
      },
    }).expect(200);
    const res = await a2a(keyA, {
      skill: 'crear_cuenta',
      params: {
        customer: { document_type: 'CC', document_number: DOC },
        items: [
          {
            description: 'Cambio de aceite',
            quantity: 1,
            unit_price: '80000.00',
          },
        ],
        payment: { method: 'cash' },
      },
    }).expect(200);
    return res.body.data.receipt.receipt_number as number;
  };

  const isPdf = (res: Binary) =>
    res.body.subarray(0, 5).toString('latin1') === '%PDF-';

  beforeAll(async () => {
    app = await createTestApp();
    dataSource = app.get(DataSource);
    partners = app.get(PartnersService);
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
    keyA = (await partners.create({ slug: 'negocio-a', name: 'Negocio A' }))
      .apiKey;
    keyB = (await partners.create({ slug: 'negocio-b', name: 'Negocio B' }))
      .apiKey;
    readOnlyKey = (
      await partners.create({
        slug: 'solo-cuenta',
        name: 'Solo cuenta',
        skills: ['consultar_cuenta'],
      })
    ).apiKey;
  });

  describe('GET /a2a/receipts/:receipt_number/pdf (el negocio emisor)', () => {
    it('entrega el PDF del comprobante como descarga', async () => {
      const number = await receiptOfA();

      const res = await partnerPdf(number, keyA).expect(200);

      expect(res.headers['content-type']).toBe('application/pdf');
      expect(res.headers['content-disposition']).toBe(
        `attachment; filename="comprobante-${number}.pdf"`,
      );
      expect(res.headers['cache-control']).toBe('no-store');
      expect(isPdf(res as unknown as Binary)).toBe(true);
      expect(res.body.length).toBeGreaterThan(1500);
    });

    it('sin key responde 401', async () => {
      const number = await receiptOfA();
      await partnerPdf(number).expect(401);
    });

    it('un comprobante de otro negocio responde igual que uno inexistente', async () => {
      const number = await receiptOfA();

      const foreign = await request(app.getHttpServer())
        .get(`/a2a/receipts/${number}/pdf`)
        .set('Authorization', `Bearer ${keyB}`)
        .expect(404);
      const missing = await request(app.getHttpServer())
        .get('/a2a/receipts/99999/pdf')
        .set('Authorization', `Bearer ${keyB}`)
        .expect(404);

      const strip = (body: Record<string, unknown>) => ({
        ...body,
        request_id: undefined,
      });
      expect(strip(foreign.body)).toEqual(strip(missing.body));
      expect(foreign.body.data.error_code).toBe('RECEIPT_NOT_FOUND');
    });

    it('exige el permiso de consultar comprobantes', async () => {
      const number = await receiptOfA();

      const res = await request(app.getHttpServer())
        .get(`/a2a/receipts/${number}/pdf`)
        .set('Authorization', `Bearer ${readOnlyKey}`)
        .expect(403);

      expect(res.body.data.error_code).toBe('SKILL_NOT_ALLOWED');
    });

    it.each(['abc', '1.5', '0x10'])(
      'rechaza el número %s con 400',
      async (bad) => {
        await partnerPdf(bad, keyA).expect(400);
      },
    );
  });

  describe('POST /public/receipts/pdf (con el documento del cliente)', () => {
    it('entrega el PDF con el número y el documento correctos', async () => {
      const number = await receiptOfA();

      const res = await publicPdf({
        receipt_number: number,
        document_number: '1.032.456.789',
      }).expect(200);

      expect(res.headers['content-type']).toBe('application/pdf');
      expect(isPdf(res as unknown as Binary)).toBe(true);
    });

    it('un documento equivocado y un número inexistente responden exactamente igual', async () => {
      const number = await receiptOfA();

      const wrongDoc = await request(app.getHttpServer())
        .post('/public/receipts/pdf')
        .send({ receipt_number: number, document_number: '999999999' })
        .expect(404);
      const missing = await request(app.getHttpServer())
        .post('/public/receipts/pdf')
        .send({ receipt_number: 99999, document_number: DOC })
        .expect(404);

      const strip = (body: Record<string, unknown>) => ({
        ...body,
        request_id: undefined,
      });
      expect(strip(wrongDoc.body)).toEqual(strip(missing.body));
    });

    it('valida el cuerpo: sin documento responde 400', async () => {
      await request(app.getHttpServer())
        .post('/public/receipts/pdf')
        .send({ receipt_number: 1 })
        .expect(400);
    });
  });
});
