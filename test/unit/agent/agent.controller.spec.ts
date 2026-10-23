import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AgentController } from '../../../src/agent/agent.controller';
import { AgentOrchestrator } from '../../../src/agent/agent.orchestrator';
import type { InvoiceResultData } from '../../../src/agent/dto/agent-response.dto';
import { LLM_EXTRACTOR } from '../../../src/agent/llm/llm-extractor.port';
import { LlmUnavailableError } from '../../../src/agent/llm/llm.errors';
import {
  MOCK_EXTRACTIONS,
  MockExtractor,
} from '../../../src/agent/llm/mock-extractor';
import { BILLING_GATEWAY } from '../../../src/agent/ports/billing-gateway.port';
import { CUSTOMER_LOOKUP } from '../../../src/agent/ports/customer-lookup.port';
import { configureApp } from '../../../src/app.setup';
import configuration from '../../../src/common/config/configuration';

// POST /agent/requests sobre HTTP, con la configuración global real (guard,
// ValidationPipe, request_id y filtro) y el extractor simulado. Sin base de datos.

const API_KEY = 'clave-agent';
const TEXT =
  'Cóbrale a la cédula 1032456789 un cambio de aceite de 80.000 y un filtro de 25.000, pagó en efectivo';

const PAID_INVOICE: InvoiceResultData = {
  invoice_id: 'b2f1c0de-0000-4000-8000-000000000001',
  customer: {
    document_type: 'CC',
    document_number: '1032456789',
    full_name: 'Cliente de ejemplo',
  },
  items: [
    {
      description: 'Cambio de aceite',
      quantity: 1,
      unit_price: '80000.00',
      line_total: '80000.00',
    },
    {
      description: 'Filtro',
      quantity: 1,
      unit_price: '25000.00',
      line_total: '25000.00',
    },
  ],
  subtotal: '105000.00',
  tax_rate: '0.1900',
  tax_amount: '19950.00',
  total: '124950.00',
  payment: { method: 'cash', amount: '124950.00', status: 'APPLIED' },
  receipt: { receipt_number: 1, issued_at: '2026-10-21T16:50:00-05:00' },
};

describe('POST /agent/requests', () => {
  let app: INestApplication<App>;
  const extractor = new MockExtractor();
  const customers = { findByDocument: jest.fn() };
  const billing = {
    createInvoice: jest.fn(),
    registerPayment: jest.fn(),
    getReceipt: jest.fn(),
    findPendingInvoiceIds: jest.fn(),
  };

  beforeAll(async () => {
    process.env.SERVICE_API_KEY = API_KEY;
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [configuration],
        }),
      ],
      controllers: [AgentController],
      providers: [
        AgentOrchestrator,
        { provide: LLM_EXTRACTOR, useValue: extractor },
        { provide: CUSTOMER_LOOKUP, useValue: customers },
        { provide: BILLING_GATEWAY, useValue: billing },
      ],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    extractor.respondWith(MOCK_EXTRACTIONS.completeInvoice);
    customers.findByDocument.mockReset().mockResolvedValue([
      {
        id: 'cust-1',
        document_type: 'CC',
        document_number: '1032456789',
        full_name: 'Cliente de ejemplo',
      },
    ]);
    billing.createInvoice.mockReset().mockResolvedValue(PAID_INVOICE);
  });

  const post = (idempotencyKey: string | null = 'idem-1') => {
    const req = request(app.getHttpServer())
      .post('/agent/requests')
      .set('X-API-Key', API_KEY);
    return idempotencyKey ? req.set('Idempotency-Key', idempotencyKey) : req;
  };

  it('resuelve el ejemplo de la sección 7.3 con 200 completed', async () => {
    const res = await post()
      .send({ request_id: 'sup-20261021-0001', text: TEXT })
      .expect(200);

    expect(res.body).toEqual({
      status: 'completed',
      message: 'Cuenta de cobro creada y pagada en efectivo.',
      data: {
        ...PAID_INVOICE,
        customer: { ...PAID_INVOICE.customer, document_number: '****6789' },
      },
      missing_fields: [],
      request_id: 'sup-20261021-0001',
    });
    expect(res.headers['x-request-id']).toBe('sup-20261021-0001');
    expect(billing.createInvoice).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: 'idem-1' }),
    );
  });

  it('sin request_id usa X-Request-Id o genera uno', async () => {
    const res = await post()
      .set('X-Request-Id', 'sup-header-1')
      .send({ text: TEXT })
      .expect(200);
    expect(res.body.request_id).toBe('sup-header-1');

    const generated = await post().send({ text: TEXT }).expect(200);
    expect(generated.body.request_id).toEqual(expect.any(String));
  });

  it('sin cédula responde 200 needs_clarification sin escribir', async () => {
    extractor.respondWith(MOCK_EXTRACTIONS.missingDocument);

    const res = await post()
      .send({ text: 'cóbrale un cambio de aceite' })
      .expect(200);

    expect(res.body).toMatchObject({
      status: 'needs_clarification',
      data: null,
      missing_fields: ['customer.document_number'],
    });
    expect(billing.createInvoice).not.toHaveBeenCalled();
  });

  it('con cédula inexistente responde 200 rejected CUSTOMER_NOT_FOUND', async () => {
    customers.findByDocument.mockResolvedValue([]);

    const res = await post().send({ text: TEXT }).expect(200);

    expect(res.body).toMatchObject({
      status: 'rejected',
      data: { error_code: 'CUSTOMER_NOT_FOUND' },
    });
  });

  it.each([
    [false, 502],
    [true, 504],
  ])(
    'si el modelo no responde (timeout=%s) responde %i con status error',
    async (timedOut, httpStatus) => {
      extractor.respondWith(
        new LlmUnavailableError('El modelo no está disponible', timedOut),
      );

      const res = await post().send({ text: TEXT }).expect(httpStatus);

      expect(res.body).toMatchObject({
        status: 'error',
        data: { error_code: 'LLM_UNAVAILABLE' },
      });
      expect(billing.createInvoice).not.toHaveBeenCalled();
    },
  );

  it('sin X-API-Key responde 401', async () => {
    await request(app.getHttpServer())
      .post('/agent/requests')
      .set('Idempotency-Key', 'idem-1')
      .send({ text: TEXT })
      .expect(401);
  });

  it('sin Idempotency-Key responde 400', async () => {
    const res = await post(null).send({ text: TEXT }).expect(400);
    expect(res.body).toMatchObject({
      status: 'rejected',
      missing_fields: ['Idempotency-Key'],
    });
  });

  it.each([
    ['sin text', {}],
    ['text vacío', { text: '' }],
    ['text demasiado largo', { text: 'a'.repeat(2001) }],
    ['campo no declarado', { text: TEXT, total: '1' }],
    ['request_id inválido', { text: TEXT, request_id: 'con espacios' }],
  ])('%s responde 400', async (_name, body) => {
    await post().send(body).expect(400);
  });

  it('no devuelve la cédula completa en ninguna respuesta', async () => {
    const res = await post().send({ text: TEXT }).expect(200);
    expect(JSON.stringify(res.body)).not.toContain('1032456789');
  });
});
