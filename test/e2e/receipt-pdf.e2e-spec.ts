import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { PartnersService } from '../../src/partners/partners.service';
import {
  RECEIPT_LINK_TTL_SECONDS,
  ReceiptLinkService,
} from '../../src/receipts/receipt-link.service';
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

  describe('enlace firmado al PDF (para el chat del negocio)', () => {
    const pathOf = (url: string) => new URL(url).pathname;

    const createPaid = async (key: string, idem?: string) => {
      await a2a(keyA, {
        skill: 'registrar_cliente',
        params: {
          document_type: 'CC',
          document_number: DOC,
          full_name: 'Ana Pérez',
        },
      });
      return request(app.getHttpServer())
        .post('/a2a/tasks')
        .set('Authorization', `Bearer ${keyA}`)
        .set('Idempotency-Key', idem ?? key)
        .send({
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
        })
        .expect(200);
    };

    it('crear una cuenta pagada devuelve el enlace en data.receipt.pdf_url y al final de answer', async () => {
      const res = await createPaid(nextKey());

      const url = res.body.data.receipt.pdf_url as string;
      expect(url).toMatch(/\/public\/receipts\/[\w-]+\.[\w-]+\/pdf$/);
      expect(res.body.answer).toMatch(/ Comprobante en PDF: \S+\/pdf$/);
      expect(res.body.answer.endsWith(url)).toBe(true);
    });

    it('el enlace abre el PDF sin key y sin ningún otro dato', async () => {
      const res = await createPaid(nextKey());
      const path = pathOf(res.body.data.receipt.pdf_url);

      const pdf = await request(app.getHttpServer())
        .get(path)
        .buffer(true)
        .parse(binary as never)
        .expect(200);

      expect(pdf.headers['content-type']).toBe('application/pdf');
      expect(isPdf(pdf as unknown as Binary)).toBe(true);
    });

    it('repetir la petición con la misma Idempotency-Key también trae el enlace', async () => {
      const key = nextKey();
      const first = await createPaid(key);
      const replay = await createPaid(key);

      expect(replay.body.data.invoice_id).toBe(first.body.data.invoice_id);
      expect(replay.body.data.receipt.pdf_url).toMatch(/\/pdf$/);
      expect(replay.body.answer).toContain('Comprobante en PDF: ');
    });

    it('una cuenta pendiente (sin comprobante) no lleva enlace', async () => {
      await a2a(keyA, {
        skill: 'registrar_cliente',
        params: {
          document_type: 'CC',
          document_number: DOC,
          full_name: 'Ana Pérez',
        },
      });
      const res = await a2a(keyA, {
        skill: 'crear_cuenta',
        params: {
          customer: { document_type: 'CC', document_number: DOC },
          items: [
            { description: 'Filtro', quantity: 1, unit_price: '25000.00' },
          ],
        },
      }).expect(200);

      expect(res.body.data.receipt).toBeNull();
      expect(res.body.answer).not.toContain('PDF');
    });

    it('registrar el pago de una cuenta pendiente trae el enlace', async () => {
      await a2a(keyA, {
        skill: 'registrar_cliente',
        params: {
          document_type: 'CC',
          document_number: DOC,
          full_name: 'Ana Pérez',
        },
      });
      const pending = await a2a(keyA, {
        skill: 'crear_cuenta',
        params: {
          customer: { document_type: 'CC', document_number: DOC },
          items: [
            { description: 'Filtro', quantity: 1, unit_price: '25000.00' },
          ],
        },
      }).expect(200);

      const paid = await a2a(keyA, {
        skill: 'registrar_pago',
        params: {
          invoice_id: pending.body.data.invoice_id,
          method: 'transfer',
        },
      }).expect(200);

      expect(paid.body.data.receipt.pdf_url).toMatch(/\/pdf$/);
      expect(paid.body.answer).toContain('Comprobante en PDF: ');
    });

    it('consultar el comprobante también trae el enlace', async () => {
      const number = await receiptOfA();

      const res = await a2a(keyA, {
        skill: 'consultar_comprobante',
        params: { receipt_number: number },
      }).expect(200);

      expect(res.body.data.receipt.pdf_url).toMatch(/\/pdf$/);
    });

    it('un enlace alterado, uno inventado y un número inexistente responden exactamente igual', async () => {
      const res = await createPaid(nextKey());
      const path = pathOf(res.body.data.receipt.pdf_url);
      const [payload, signature] = path.split('/')[3].split('.');

      const tampered = await request(app.getHttpServer())
        .get(`/public/receipts/${payload}.${signature.slice(0, -2)}AA/pdf`)
        .expect(404);
      const invented = await request(app.getHttpServer())
        .get('/public/receipts/abc.def/pdf')
        .expect(404);
      const garbage = await request(app.getHttpServer())
        .get('/public/receipts/%3Cscript%3E/pdf')
        .expect(404);

      const strip = (body: Record<string, unknown>) => ({
        ...body,
        request_id: undefined,
      });
      expect(strip(tampered.body)).toEqual(strip(invented.body));
      expect(strip(garbage.body)).toEqual(strip(invented.body));
      expect(tampered.body.data.error_code).toBe('RECEIPT_NOT_FOUND');
    });

    it('un enlace vencido responde 404 y no abre el PDF', async () => {
      const number = await receiptOfA();
      const old = Date.now() - (RECEIPT_LINK_TTL_SECONDS + 60) * 1000;
      const token = app.get(ReceiptLinkService).issue(number, old);

      await request(app.getHttpServer())
        .get(`/public/receipts/${token}/pdf`)
        .expect(404);
    });
  });
});
