import { AgentOrchestrator } from '../../../src/agent/agent.orchestrator';
import type { InvoiceResultData } from '../../../src/agent/dto/agent-response.dto';
import type { Extraction } from '../../../src/agent/llm/extraction.schema';
import {
  ExtractionFailedError,
  LlmUnavailableError,
} from '../../../src/agent/llm/llm.errors';
import {
  MOCK_EXTRACTIONS,
  MockExtractor,
} from '../../../src/agent/llm/mock-extractor';
import type { BillingGateway } from '../../../src/agent/ports/billing-gateway.port';
import type {
  CustomerLookup,
  CustomerSummary,
} from '../../../src/agent/ports/customer-lookup.port';

const REQUEST = {
  text: 'Cóbrale a la cédula 1032456789 un cambio de aceite de 80.000 y un filtro de 25.000, pagó en efectivo',
  requestId: 'sup-20261021-0001',
  idempotencyKey: 'idem-1',
};
const INVOICE_ID = 'b2f1c0de-0000-4000-8000-000000000001';

const CUSTOMER: CustomerSummary = {
  id: 'cust-1',
  document_type: 'CC',
  document_number: '1032456789',
  full_name: 'Cliente de ejemplo',
};

// Resultado de la sección 7.4, tal como lo devolvería el dominio.
const PAID_INVOICE: InvoiceResultData = {
  invoice_id: INVOICE_ID,
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

class DomainError extends Error {
  constructor(readonly code: string) {
    super('');
  }
}

// Dobles como propiedades jest.Mock: se leen sin perder `this`.
type MockOf<T> = { [K in keyof T]: jest.Mock };

function setup(
  extraction: Extraction | Error = MOCK_EXTRACTIONS.completeInvoice,
) {
  const extractor = new MockExtractor(extraction);
  const customers: MockOf<CustomerLookup> = {
    findByDocument: jest.fn().mockResolvedValue([CUSTOMER]),
  };
  const billing: MockOf<BillingGateway> = {
    createInvoice: jest.fn().mockResolvedValue(PAID_INVOICE),
    registerPayment: jest.fn().mockResolvedValue(PAID_INVOICE),
    getReceipt: jest.fn().mockResolvedValue(PAID_INVOICE),
    findPendingInvoiceIds: jest.fn().mockResolvedValue([INVOICE_ID]),
  };
  const orchestrator = new AgentOrchestrator(extractor, customers, billing);
  return { orchestrator, extractor, customers, billing };
}

function expectNoWrites(billing: MockOf<BillingGateway>) {
  expect(billing.createInvoice).not.toHaveBeenCalled();
  expect(billing.registerPayment).not.toHaveBeenCalled();
}

describe('AgentOrchestrator', () => {
  describe('create_invoice', () => {
    it('resuelve el ejemplo de la sección 7.3 con completed', async () => {
      const { orchestrator, extractor, customers, billing } = setup();

      const response = await orchestrator.handle(REQUEST);

      expect(extractor.calls).toEqual([
        { text: REQUEST.text, context: { requestId: REQUEST.requestId } },
      ]);
      expect(customers.findByDocument).toHaveBeenCalledWith('CC', '1032456789');
      expect(billing.createInvoice).toHaveBeenCalledWith(
        expect.objectContaining({
          customerId: 'cust-1',
          idempotencyKey: 'idem-1',
          source: 'agent',
          payment: { method: 'cash', amount: null },
        }),
      );
      expect(response).toEqual({
        status: 'completed',
        message: 'Cuenta de cobro creada y pagada en efectivo.',
        data: {
          ...PAID_INVOICE,
          customer: { ...PAID_INVOICE.customer, document_number: '****6789' },
        },
        missing_fields: [],
        request_id: REQUEST.requestId,
      });
    });

    it('sin pago informa que la cuenta queda pendiente', async () => {
      const { orchestrator, billing } = setup();
      billing.createInvoice.mockResolvedValue({
        ...PAID_INVOICE,
        payment: null,
        receipt: null,
      });

      const response = await orchestrator.handle(REQUEST);
      expect(response.message).toBe(
        'Cuenta de cobro creada; queda pendiente de pago.',
      );
    });

    it('sin cédula responde needs_clarification sin escribir', async () => {
      const { orchestrator, customers, billing } = setup(
        MOCK_EXTRACTIONS.missingDocument,
      );

      const response = await orchestrator.handle(REQUEST);

      expect(response).toEqual({
        status: 'needs_clarification',
        message: 'Falta el número de documento del cliente.',
        data: null,
        missing_fields: ['customer.document_number'],
        request_id: REQUEST.requestId,
      });
      expect(customers.findByDocument).not.toHaveBeenCalled();
      expectNoWrites(billing);
    });

    it('con un monto mal normalizado pide corregirlo', async () => {
      const { orchestrator, billing } = setup({
        ...MOCK_EXTRACTIONS.completeInvoice,
        items: [{ description: 'Filtro', quantity: 1, unit_price: '25.000' }],
      });

      const response = await orchestrator.handle(REQUEST);

      expect(response.status).toBe('needs_clarification');
      expect(response.missing_fields).toEqual(['items[0].unit_price']);
      expectNoWrites(billing);
    });

    it('con una cédula inexistente responde rejected CUSTOMER_NOT_FOUND', async () => {
      const { orchestrator, customers, billing } = setup();
      customers.findByDocument.mockResolvedValue([]);

      const response = await orchestrator.handle(REQUEST);

      expect(response).toMatchObject({
        status: 'rejected',
        data: { error_code: 'CUSTOMER_NOT_FOUND' },
      });
      expectNoWrites(billing);
    });

    it('con varios clientes para el número pide el tipo de documento', async () => {
      const { orchestrator, customers } = setup();
      customers.findByDocument.mockResolvedValue([
        CUSTOMER,
        { ...CUSTOMER, id: 'cust-2', document_type: 'CE' },
      ]);

      const response = await orchestrator.handle(REQUEST);

      expect(response).toMatchObject({
        status: 'needs_clarification',
        missing_fields: ['customer.document_type'],
      });
    });

    it.each(['TOTAL_EXCEEDS_LIMIT', 'PAYMENT_MISMATCH', 'INVOICE_NOT_PAYABLE'])(
      'traduce el error de dominio %s a rejected',
      async (code) => {
        const { orchestrator, billing } = setup();
        billing.createInvoice.mockRejectedValue(new DomainError(code));

        const response = await orchestrator.handle(REQUEST);

        expect(response).toMatchObject({
          status: 'rejected',
          data: { error_code: code },
          message: expect.any(String),
        });
        expect(response.message.length).toBeGreaterThan(0);
      },
    );
  });

  describe('register_payment', () => {
    const payment: Extraction = {
      ...MOCK_EXTRACTIONS.completeInvoice,
      intent: 'register_payment',
      items: [],
      payment: { method: 'transfer', amount: null },
    };

    it('usa la única cuenta PENDING del cliente (RN-08)', async () => {
      const { orchestrator, billing } = setup(payment);

      const response = await orchestrator.handle(REQUEST);

      expect(billing.findPendingInvoiceIds).toHaveBeenCalledWith('cust-1');
      expect(billing.registerPayment).toHaveBeenCalledWith({
        invoiceId: INVOICE_ID,
        method: 'transfer',
        amount: null,
        idempotencyKey: 'idem-1',
      });
      expect(response.status).toBe('completed');
    });

    it('con invoice_id no busca al cliente', async () => {
      const { orchestrator, customers, billing } = setup({
        ...payment,
        related_ids: {
          invoice_id: INVOICE_ID,
          receipt_number: null,
          external_ref: null,
        },
      });

      await orchestrator.handle(REQUEST);

      expect(customers.findByDocument).not.toHaveBeenCalled();
      expect(billing.registerPayment).toHaveBeenCalledWith(
        expect.objectContaining({ invoiceId: INVOICE_ID }),
      );
    });

    it.each([[[]], [[INVOICE_ID, 'otra']]])(
      'con %j cuentas pendientes pide indicar la cuenta',
      async (pending) => {
        const { orchestrator, billing } = setup(payment);
        billing.findPendingInvoiceIds.mockResolvedValue(pending);

        const response = await orchestrator.handle(REQUEST);

        expect(response).toMatchObject({
          status: 'needs_clarification',
          missing_fields: ['related_ids.invoice_id'],
        });
        expectNoWrites(billing);
      },
    );
  });

  describe('get_receipt', () => {
    it('consulta por número de comprobante', async () => {
      const { orchestrator, billing } = setup({
        ...MOCK_EXTRACTIONS.unknownIntent,
        intent: 'get_receipt',
        related_ids: {
          invoice_id: null,
          receipt_number: 1,
          external_ref: null,
        },
      });

      const response = await orchestrator.handle(REQUEST);

      expect(billing.getReceipt).toHaveBeenCalledWith({ receiptNumber: 1 });
      expect(response).toMatchObject({
        status: 'completed',
        message: 'Comprobante 1 encontrado.',
      });
      expectNoWrites(billing);
    });
  });

  describe('fallos del modelo', () => {
    it('la intención unknown no ejecuta nada (RN-11)', async () => {
      const { orchestrator, customers, billing } = setup(
        MOCK_EXTRACTIONS.unknownIntent,
      );

      const response = await orchestrator.handle(REQUEST);

      expect(response.status).toBe('needs_clarification');
      expect(customers.findByDocument).not.toHaveBeenCalled();
      expectNoWrites(billing);
    });

    it('con EXTRACTION_FAILED pide reformular', async () => {
      const { orchestrator, billing } = setup(new ExtractionFailedError());

      const response = await orchestrator.handle(REQUEST);

      expect(response).toMatchObject({
        status: 'needs_clarification',
        data: null,
      });
      expectNoWrites(billing);
    });

    it('relanza LLM_UNAVAILABLE para el filtro global sin escribir', async () => {
      const error = new LlmUnavailableError();
      const { orchestrator, billing } = setup(error);

      await expect(orchestrator.handle(REQUEST)).rejects.toBe(error);
      expectNoWrites(billing);
    });

    it('relanza los errores no previstos', async () => {
      const { orchestrator, billing } = setup();
      const error = new Error('conexión perdida');
      billing.createInvoice.mockRejectedValue(error);

      await expect(orchestrator.handle(REQUEST)).rejects.toBe(error);
    });
  });
});
