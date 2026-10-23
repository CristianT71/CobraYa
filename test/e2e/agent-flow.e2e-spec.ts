import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { LLM_EXTRACTOR } from '../../src/agent/llm/llm-extractor.port';
import { LlmUnavailableError } from '../../src/agent/llm/llm.errors';
import {
  MOCK_EXTRACTIONS,
  MockExtractor,
} from '../../src/agent/llm/mock-extractor';
import type { Extraction } from '../../src/agent/llm/extraction.schema';
import { Invoice } from '../../src/billing/entities/invoice.entity';
import { Payment } from '../../src/billing/entities/payment.entity';
import { Receipt } from '../../src/billing/entities/receipt.entity';
import {
  api,
  createTestApp,
  describeWithDb,
  resetDatabase,
} from './support/test-app';

// Criterios de aceptación del grupo (reparto, sección 9.1) sobre la aplicación
// completa: HTTP real, PostgreSQL real y solo el modelo simulado.

const TEXT =
  'Cóbrale a la cédula 1032456789 un cambio de aceite de 80.000 y un filtro de 25.000, pagó en efectivo';

const withoutPayment: Extraction = {
  ...MOCK_EXTRACTIONS.completeInvoice,
  payment: { method: null, amount: null },
};

const noIds = { invoice_id: null, receipt_number: null, external_ref: null };

describeWithDb('Camino con IA de punta a punta (e2e con PostgreSQL)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  const extractor = new MockExtractor();
  let keyCounter = 0;
  const nextKey = () => `e2e-agent-${Date.now()}-${keyCounter++}`;

  const count = (entity: new () => unknown) =>
    dataSource.getRepository(entity).count();

  const agent = (idempotencyKey: string | null = nextKey()) =>
    api(app as never).post('/agent/requests', idempotencyKey ?? undefined);

  beforeAll(async () => {
    app = await createTestApp([
      { provide: LLM_EXTRACTOR, useValue: extractor },
    ]);
    dataSource = app.get(DataSource);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase(app);
    extractor.respondWith(MOCK_EXTRACTIONS.completeInvoice);
  });

  it('resuelve el ejemplo de la sección 7.3 con completed y los totales correctos', async () => {
    const res = await agent()
      .send({ request_id: 'sup-20261021-0001', text: TEXT })
      .expect(200);

    expect(res.body).toMatchObject({
      status: 'completed',
      message: 'Cuenta de cobro creada y pagada en efectivo.',
      missing_fields: [],
      request_id: 'sup-20261021-0001',
      data: {
        customer: { document_type: 'CC', document_number: '****6789' },
        subtotal: '105000.00',
        tax_rate: '0.1900',
        tax_amount: '19950.00',
        total: '124950.00',
        payment: { method: 'cash', amount: '124950.00', status: 'APPLIED' },
        receipt: { receipt_number: 1 },
      },
    });
    expect(JSON.stringify(res.body)).not.toContain('1032456789');
    expect(await count(Invoice)).toBe(1);
    expect(await count(Payment)).toBe(1);
    expect(await count(Receipt)).toBe(1);

    const [invoice] = await dataSource.getRepository(Invoice).find();
    expect(invoice.source).toBe('agent');
  });

  it('repetir la misma Idempotency-Key no duplica cuenta, pago ni comprobante', async () => {
    const key = nextKey();

    const first = await agent(key).send({ text: TEXT }).expect(200);
    const repeated = await agent(key).send({ text: TEXT }).expect(200);

    expect(repeated.body.data).toEqual(first.body.data);
    expect(await count(Invoice)).toBe(1);
    expect(await count(Payment)).toBe(1);
    expect(await count(Receipt)).toBe(1);
  });

  it('la misma clave con una solicitud distinta responde 409', async () => {
    const key = nextKey();
    await agent(key).send({ text: TEXT }).expect(200);

    extractor.respondWith(withoutPayment);
    const res = await agent(key).send({ text: TEXT }).expect(409);

    expect(res.body).toMatchObject({
      status: 'rejected',
      data: { error_code: 'IDEMPOTENCY_CONFLICT' },
    });
    expect(await count(Invoice)).toBe(1);
  });

  it('el camino directo produce los mismos totales que el camino con IA', async () => {
    const viaAgent = await agent().send({ text: TEXT }).expect(200);

    const viaDirect = await api(app as never)
      .post('/billing/invoices', nextKey())
      .send({
        customer: { document_type: 'CC', document_number: '1032456789' },
        items: [
          {
            description: 'Cambio de aceite',
            quantity: 1,
            unit_price: '80000.00',
          },
          { description: 'Filtro', quantity: 1, unit_price: '25000.00' },
        ],
        payment: { method: 'cash' },
      })
      .expect(201);

    for (const field of ['subtotal', 'tax_rate', 'tax_amount', 'total']) {
      expect(viaDirect.body[field]).toBe(viaAgent.body.data[field]);
    }
    expect(viaDirect.body.payment).toEqual(viaAgent.body.data.payment);
    expect(await count(Receipt)).toBe(2);
  });

  describe('los cuatro estados de respuesta', () => {
    it('needs_clarification: sin cédula no escribe en la base de datos', async () => {
      extractor.respondWith(MOCK_EXTRACTIONS.missingDocument);

      const res = await agent()
        .send({ text: 'cóbrale un cambio de aceite' })
        .expect(200);

      expect(res.body).toMatchObject({
        status: 'needs_clarification',
        data: null,
        missing_fields: ['customer.document_number'],
      });
      expect(await count(Invoice)).toBe(0);
    });

    it('needs_clarification no consume la Idempotency-Key', async () => {
      const key = nextKey();
      extractor.respondWith(MOCK_EXTRACTIONS.missingDocument);
      await agent(key).send({ text: 'cóbrale algo' }).expect(200);

      extractor.respondWith(MOCK_EXTRACTIONS.completeInvoice);
      const res = await agent(key).send({ text: TEXT }).expect(200);

      expect(res.body.status).toBe('completed');
      expect(await count(Invoice)).toBe(1);
    });

    it('needs_clarification: una cédula en dos tipos de documento pide el tipo', async () => {
      extractor.respondWith({
        ...MOCK_EXTRACTIONS.completeInvoice,
        customer: { document_type: null, document_number: '4567890' },
      });

      const res = await agent().send({ text: 'cobro al 4567890' }).expect(200);

      expect(res.body).toMatchObject({
        status: 'needs_clarification',
        missing_fields: ['customer.document_type'],
      });
      expect(await count(Invoice)).toBe(0);
    });

    it('rejected: una cédula inexistente responde CUSTOMER_NOT_FOUND', async () => {
      extractor.respondWith({
        ...MOCK_EXTRACTIONS.completeInvoice,
        customer: { document_type: 'CC', document_number: '999999999' },
      });

      const res = await agent().send({ text: 'cobro a otro' }).expect(200);

      expect(res.body).toMatchObject({
        status: 'rejected',
        data: { error_code: 'CUSTOMER_NOT_FOUND' },
      });
      expect(await count(Invoice)).toBe(0);
    });

    it('rejected: un total sobre el límite responde TOTAL_EXCEEDS_LIMIT', async () => {
      extractor.respondWith({
        ...MOCK_EXTRACTIONS.completeInvoice,
        items: [
          { description: 'Motor', quantity: 1, unit_price: '50000000.00' },
        ],
      });

      const res = await agent().send({ text: 'un motor' }).expect(200);

      expect(res.body).toMatchObject({
        status: 'rejected',
        data: { error_code: 'TOTAL_EXCEEDS_LIMIT' },
      });
      expect(await count(Invoice)).toBe(0);
    });

    it.each([
      [false, 502],
      [true, 504],
    ])(
      'error: si el modelo no responde (timeout=%s) responde %i y no guarda nada',
      async (timedOut, httpStatus) => {
        extractor.respondWith(
          new LlmUnavailableError('El modelo no está disponible', timedOut),
        );

        const res = await agent().send({ text: TEXT }).expect(httpStatus);

        expect(res.body).toMatchObject({
          status: 'error',
          data: { error_code: 'LLM_UNAVAILABLE' },
        });
        expect(await count(Invoice)).toBe(0);
      },
    );
  });

  describe('registrar un pago y consultar un comprobante por texto', () => {
    it('paga la única cuenta pendiente del cliente y luego consulta el comprobante', async () => {
      extractor.respondWith(withoutPayment);
      const pending = await agent()
        .send({ text: 'cóbrale sin pago' })
        .expect(200);
      expect(pending.body.data.payment).toBeNull();
      expect(pending.body.data.receipt).toBeNull();

      extractor.respondWith({
        ...MOCK_EXTRACTIONS.completeInvoice,
        intent: 'register_payment',
        items: [],
        payment: { method: 'transfer', amount: null },
      });
      const paid = await agent()
        .send({ text: 'ya pagó por transferencia' })
        .expect(200);

      expect(paid.body).toMatchObject({
        status: 'completed',
        data: {
          invoice_id: pending.body.data.invoice_id,
          total: '124950.00',
          payment: { method: 'transfer', status: 'APPLIED' },
          receipt: { receipt_number: 1 },
        },
      });

      extractor.respondWith({
        ...MOCK_EXTRACTIONS.unknownIntent,
        intent: 'get_receipt',
        related_ids: { ...noIds, receipt_number: 1 },
      });
      const receipt = await agent().send({ text: 'comprobante 1' }).expect(200);

      expect(receipt.body.data).toEqual(paid.body.data);
    });

    it('rejected: pagar una cuenta ya pagada responde INVOICE_NOT_PAYABLE', async () => {
      const created = await agent().send({ text: TEXT }).expect(200);

      extractor.respondWith({
        ...MOCK_EXTRACTIONS.completeInvoice,
        intent: 'register_payment',
        items: [],
        related_ids: { ...noIds, invoice_id: created.body.data.invoice_id },
        payment: { method: 'cash', amount: null },
      });
      const res = await agent().send({ text: 'otro pago' }).expect(200);

      expect(res.body).toMatchObject({
        status: 'rejected',
        data: { error_code: 'INVOICE_NOT_PAYABLE' },
      });
      expect(await count(Payment)).toBe(1);
    });

    it('rejected: un comprobante inexistente responde RECEIPT_NOT_FOUND', async () => {
      extractor.respondWith({
        ...MOCK_EXTRACTIONS.unknownIntent,
        intent: 'get_receipt',
        related_ids: { ...noIds, receipt_number: 999 },
      });

      const res = await agent().send({ text: 'comprobante 999' }).expect(200);

      expect(res.body).toMatchObject({
        status: 'rejected',
        data: { error_code: 'RECEIPT_NOT_FOUND' },
      });
    });
  });
});
