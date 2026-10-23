import {
  describeInvoice,
  formatCop,
  isInvoiceData,
} from '../../../src/a2a/answers';
import type { InvoiceResultData } from '../../../src/billing/dto/invoice-result.dto';

const PAID: InvoiceResultData = {
  invoice_id: 'b2f1c0de-0000-4000-8000-000000000001',
  customer: {
    document_type: 'CC',
    document_number: '****6789',
    full_name: 'Cliente de ejemplo',
  },
  items: [
    {
      description: 'Cambio de aceite',
      quantity: 1,
      unit_price: '80000.00',
      line_total: '80000.00',
    },
  ],
  subtotal: '105000.00',
  tax_rate: '0.1900',
  tax_amount: '19950.00',
  total: '124950.00',
  payment: { method: 'cash', amount: '124950.00', status: 'APPLIED' },
  receipt: { receipt_number: 7, issued_at: '2026-10-21T16:50:00-05:00' },
};

describe('formatCop', () => {
  it.each([
    ['124950.00', '$124.950'],
    ['0.00', '$0'],
    ['999.00', '$999'],
    ['1000.00', '$1.000'],
    ['1234567.00', '$1.234.567'],
    ['50000000.00', '$50.000.000'],
    ['1234.50', '$1.234,50'],
    ['0.05', '$0,05'],
    ['19950', '$19.950'],
    ['19950.5', '$19.950,50'],
  ])('%s -> %s', (input, expected) => {
    expect(formatCop(input)).toBe(expected);
  });
});

describe('describeInvoice', () => {
  it('incluye cliente, total con su desglose, pago, comprobante y cuenta', () => {
    const answer = describeInvoice(
      'Cuenta de cobro creada y pagada en efectivo.',
      PAID,
    );

    expect(answer).toBe(
      'Cuenta de cobro creada y pagada en efectivo. ' +
        'Cliente Cliente de ejemplo (****6789). ' +
        'Total $124.950 (subtotal $105.000 + impuesto $19.950). ' +
        'Pago en efectivo por $124.950. ' +
        'Comprobante N.º 7. ' +
        'Cuenta b2f1c0de-0000-4000-8000-000000000001.',
    );
  });

  it('sin pago ni comprobante no los menciona', () => {
    const answer = describeInvoice(
      'Cuenta de cobro creada; queda pendiente de pago.',
      {
        ...PAID,
        payment: null,
        receipt: null,
      },
    );

    expect(answer).not.toContain('Pago ');
    expect(answer).not.toContain('Comprobante');
    expect(answer).toContain('Total $124.950');
  });

  it.each([
    ['card', 'con tarjeta'],
    ['transfer', 'por transferencia'],
  ] as const)('el método %s se dice "%s"', (method, label) => {
    const answer = describeInvoice('ok', {
      ...PAID,
      payment: { method, amount: '124950.00', status: 'APPLIED' },
    });

    expect(answer).toContain(`Pago ${label}`);
  });
});

describe('isInvoiceData', () => {
  it('reconoce el resultado de una cuenta', () => {
    expect(isInvoiceData(PAID)).toBe(true);
  });

  it.each([
    null,
    undefined,
    'texto',
    3,
    {},
    { error_code: 'X' },
    { total: '1' },
  ])('rechaza %j', (value) => {
    expect(isInvoiceData(value)).toBe(false);
  });
});
