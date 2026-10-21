import type { Extraction } from '../../../src/agent/llm/extraction.schema';
import { MOCK_EXTRACTIONS } from '../../../src/agent/llm/mock-extractor';
import {
  checkExtraction,
  normalizeDocumentNumber,
  toCreateInvoiceCommand,
  toGetReceiptQuery,
  toRegisterPaymentCommand,
} from '../../../src/agent/mappers/extraction-to-command.mapper';

const INVOICE_ID = 'b2f1c0de-0000-4000-8000-000000000001';

function extraction(overrides: Partial<Extraction> = {}): Extraction {
  return { ...structuredClone(MOCK_EXTRACTIONS.completeInvoice), ...overrides };
}

const noPayment = { method: null, amount: null };
const noIds = { invoice_id: null, receipt_number: null, external_ref: null };

describe('normalizeDocumentNumber', () => {
  it.each([
    ['1.032.456.789', '1032456789'],
    [' 1032 456 789 ', '1032456789'],
    ['900123456-1', '9001234561'],
    ['', null],
    ['sin número', null],
    [null, null],
  ])('%s -> %s', (input, expected) => {
    expect(normalizeDocumentNumber(input)).toBe(expected);
  });
});

describe('checkExtraction', () => {
  it('no reporta nada para el ejemplo de la sección 7.3', () => {
    expect(checkExtraction(extraction())).toEqual({ missing: [], invalid: [] });
  });

  it('ignora el missing_fields del modelo y lo recalcula', () => {
    const result = checkExtraction(
      extraction({ missing_fields: ['payment.amount', 'notes'] }),
    );
    expect(result).toEqual({ missing: [], invalid: [] });
  });

  describe('create_invoice', () => {
    it('pide la cédula y los ítems cuando faltan', () => {
      const result = checkExtraction(
        extraction({
          customer: { document_type: null, document_number: null },
          items: [],
        }),
      );
      expect(result.missing).toEqual(['customer.document_number', 'items']);
    });

    it.each(['80.000', '80 mil', '80000.001', '-5', '1e5'])(
      'marca como inválido el valor unitario %s',
      (unitPrice) => {
        const result = checkExtraction(
          extraction({
            items: [
              { description: 'Filtro', quantity: 1, unit_price: unitPrice },
            ],
          }),
        );
        expect(result.invalid).toEqual(['items[0].unit_price']);
      },
    );

    it.each([0, -1, 1.234, Number.NaN])(
      'marca como inválida la cantidad %s',
      (quantity) => {
        const result = checkExtraction(
          extraction({
            items: [{ description: 'Filtro', quantity, unit_price: '100' }],
          }),
        );
        expect(result.invalid).toEqual(['items[0].quantity']);
      },
    );

    it('valida descripción vacía y de más de 200 caracteres', () => {
      const result = checkExtraction(
        extraction({
          items: [
            { description: '  ', quantity: 1, unit_price: '100' },
            { description: 'x'.repeat(201), quantity: 1, unit_price: '100' },
          ],
        }),
      );
      expect(result).toEqual({
        missing: ['items[0].description'],
        invalid: ['items[1].description'],
      });
    });

    it('valida el monto del pago si viene', () => {
      const result = checkExtraction(
        extraction({ payment: { method: 'cash', amount: '124.950' } }),
      );
      expect(result.invalid).toEqual(['payment.amount']);
    });
  });

  describe('register_payment', () => {
    it('pide la cuenta y el método si no hay cuenta ni cliente (RN-08)', () => {
      const result = checkExtraction(
        extraction({
          intent: 'register_payment',
          customer: { document_type: null, document_number: null },
          items: [],
          payment: noPayment,
        }),
      );
      expect(result.missing).toEqual([
        'related_ids.invoice_id',
        'payment.method',
      ]);
    });

    it('acepta un cliente en vez de la cuenta', () => {
      const result = checkExtraction(
        extraction({ intent: 'register_payment', items: [] }),
      );
      expect(result).toEqual({ missing: [], invalid: [] });
    });

    it('rechaza un invoice_id que no es uuid', () => {
      const result = checkExtraction(
        extraction({
          intent: 'register_payment',
          related_ids: { ...noIds, invoice_id: '123' },
        }),
      );
      expect(result.invalid).toEqual(['related_ids.invoice_id']);
    });
  });

  describe('get_receipt', () => {
    it('pide número de comprobante o cuenta (RN-10)', () => {
      const result = checkExtraction(
        extraction({ intent: 'get_receipt', related_ids: noIds }),
      );
      expect(result.missing).toEqual(['related_ids.receipt_number']);
    });

    it('no exige cliente ni ítems', () => {
      const result = checkExtraction(
        extraction({
          intent: 'get_receipt',
          customer: { document_type: null, document_number: null },
          items: [],
          related_ids: { ...noIds, receipt_number: 7 },
        }),
      );
      expect(result).toEqual({ missing: [], invalid: [] });
    });
  });
});

describe('comandos', () => {
  it('arma CreateInvoiceCommand con cantidades y montos como texto', () => {
    expect(toCreateInvoiceCommand(extraction(), 'cust-1', 'idem-1')).toEqual({
      customerId: 'cust-1',
      items: [
        {
          description: 'Cambio de aceite',
          quantity: '1',
          unitPrice: '80000.00',
        },
        { description: 'Filtro', quantity: '1', unitPrice: '25000.00' },
      ],
      payment: { method: 'cash', amount: null },
      idempotencyKey: 'idem-1',
      source: 'agent',
      externalRef: null,
    });
  });

  it('sin método de pago la cuenta queda sin pago (RN-05)', () => {
    const command = toCreateInvoiceCommand(
      extraction({ payment: noPayment }),
      'cust-1',
      'idem-1',
    );
    expect(command.payment).toBeNull();
  });

  it('arma RegisterPaymentCommand', () => {
    expect(
      toRegisterPaymentCommand(
        extraction({ payment: { method: 'card', amount: '124950.00' } }),
        INVOICE_ID,
        'idem-2',
      ),
    ).toEqual({
      invoiceId: INVOICE_ID,
      method: 'card',
      amount: '124950.00',
      idempotencyKey: 'idem-2',
    });
  });

  it('prefiere el número de comprobante a la cuenta en get_receipt', () => {
    expect(
      toGetReceiptQuery(
        extraction({
          related_ids: { ...noIds, receipt_number: 3, invoice_id: INVOICE_ID },
        }),
      ),
    ).toEqual({ receiptNumber: 3 });
    expect(
      toGetReceiptQuery(
        extraction({ related_ids: { ...noIds, invoice_id: INVOICE_ID } }),
      ),
    ).toEqual({ invoiceId: INVOICE_ID });
  });
});
