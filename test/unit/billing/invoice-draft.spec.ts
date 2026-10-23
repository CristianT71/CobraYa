import { InvoiceStatus } from '../../../src/billing/domain/invoice-status.enum';
import {
  buildInvoiceDraft,
  planPayment,
} from '../../../src/billing/domain/invoice-draft';
import { Money } from '../../../src/billing/domain/money';

const config = { taxRate: '0.19', maxInvoiceTotal: '50000000' };

const oilChange = [
  { description: 'Cambio de aceite', quantity: '1', unitPrice: '80000' },
  { description: 'Filtro', quantity: '1', unitPrice: '25000' },
];

describe('buildInvoiceDraft', () => {
  it('ejemplo del contrato: pago en efectivo → PAID con totales y comprobante', () => {
    const draft = buildInvoiceDraft(
      { items: oilChange, payment: { method: 'cash', amount: null } },
      config,
    );

    expect(draft.totals.subtotal.toString()).toBe('105000.00');
    expect(draft.totals.taxAmount.toString()).toBe('19950.00');
    expect(draft.totals.total.toString()).toBe('124950.00');
    expect(draft.status).toBe(InvoiceStatus.PAID);
    expect(draft.payment).toEqual({
      method: 'cash',
      amount: expect.any(Money),
      status: 'APPLIED',
    });
    expect(draft.payment?.amount.toString()).toBe('124950.00');
    expect(draft.issueReceipt).toBe(true);
  });

  it('sin pago la cuenta queda PENDING y no emite comprobante', () => {
    const draft = buildInvoiceDraft(
      { items: oilChange, payment: null },
      config,
    );

    expect(draft.status).toBe(InvoiceStatus.PENDING);
    expect(draft.payment).toBeNull();
    expect(draft.issueReceipt).toBe(false);
  });

  it('con TAX_RATE = 0 el total es igual al subtotal', () => {
    const draft = buildInvoiceDraft(
      { items: oilChange, payment: null },
      { ...config, taxRate: '0' },
    );
    expect(draft.totals.total.toString()).toBe('105000.00');
  });

  it('RN-03: sin ítems no calcula nada', () => {
    expect(() =>
      buildInvoiceDraft({ items: [], payment: null }, config),
    ).toThrow(expect.objectContaining({ code: 'MISSING_FIELDS' }));
  });

  it('RN-04: un total sobre el máximo se rechaza antes de pagar', () => {
    expect(() =>
      buildInvoiceDraft(
        {
          items: [
            { description: 'Motor', quantity: '1', unitPrice: '50000000' },
          ],
          payment: { method: 'card', amount: '1' },
        },
        config,
      ),
    ).toThrow(expect.objectContaining({ code: 'TOTAL_EXCEEDS_LIMIT' }));
  });

  it('RN-06: un pago distinto del total se rechaza', () => {
    expect(() =>
      buildInvoiceDraft(
        { items: oilChange, payment: { method: 'cash', amount: '100000' } },
        config,
      ),
    ).toThrow(expect.objectContaining({ code: 'PAYMENT_MISMATCH' }));
  });

  it('RN-06: un pago con el monto exacto del total se acepta', () => {
    const draft = buildInvoiceDraft(
      {
        items: oilChange,
        payment: { method: 'transfer', amount: '124950.00' },
      },
      config,
    );
    expect(draft.status).toBe(InvoiceStatus.PAID);
  });
});

describe('planPayment', () => {
  const total = Money.of('124950.00');

  it('una cuenta PENDING pasa a PAID y emite comprobante', () => {
    const decision = planPayment(InvoiceStatus.PENDING, total, {
      method: 'card',
      amount: null,
    });

    expect(decision.newStatus).toBe(InvoiceStatus.PAID);
    expect(decision.issueReceipt).toBe(true);
    expect(decision.payment.amount.toString()).toBe('124950.00');
    expect(decision.payment.method).toBe('card');
  });

  it('una cuenta PAID rechaza un segundo pago con INVOICE_NOT_PAYABLE', () => {
    expect(() =>
      planPayment(InvoiceStatus.PAID, total, { method: 'cash', amount: null }),
    ).toThrow(expect.objectContaining({ code: 'INVOICE_NOT_PAYABLE' }));
  });

  it('una cuenta CANCELLED tampoco admite pago', () => {
    expect(() =>
      planPayment(InvoiceStatus.CANCELLED, total, {
        method: 'cash',
        amount: null,
      }),
    ).toThrow(expect.objectContaining({ code: 'INVOICE_NOT_PAYABLE' }));
  });

  it('un monto distinto del total se rechaza con PAYMENT_MISMATCH', () => {
    expect(() =>
      planPayment(InvoiceStatus.PENDING, total, {
        method: 'cash',
        amount: '50000',
      }),
    ).toThrow(expect.objectContaining({ code: 'PAYMENT_MISMATCH' }));
  });
});
