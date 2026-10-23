import fc from 'fast-check';
import { InvoiceCalculator } from '../../../src/billing/domain/invoice-calculator';
import { Money } from '../../../src/billing/domain/money';
import { TaxCalculator } from '../../../src/billing/domain/tax-calculator';

const calculator = (rate: string) =>
  new InvoiceCalculator(new TaxCalculator(rate));

describe('InvoiceCalculator', () => {
  it('ejemplo del contrato: 80.000 + 25.000 con tasa 0.19', () => {
    const totals = calculator('0.19').calculate([
      { quantity: '1', unitPrice: '80000.00' },
      { quantity: '1', unitPrice: '25000.00' },
    ]);

    expect(totals.subtotal.toString()).toBe('105000.00');
    expect(totals.taxAmount.toString()).toBe('19950.00');
    expect(totals.total.toString()).toBe('124950.00');
    expect(totals.taxRate).toBe('0.1900');
  });

  it('con TAX_RATE = 0 el total es igual al subtotal', () => {
    const totals = calculator('0').calculate([
      { quantity: '2', unitPrice: '350000.00' },
    ]);

    expect(totals.subtotal.toString()).toBe('700000.00');
    expect(totals.taxAmount.toString()).toBe('0.00');
    expect(totals.total.equals(totals.subtotal)).toBe(true);
  });

  it('calcula line_total = cantidad × valor unitario por ítem', () => {
    const totals = calculator('0.19').calculate([
      { quantity: '2', unitPrice: '350000.00' },
      { quantity: '1.5', unitPrice: '19.99' },
    ]);

    expect(totals.lines.map((line) => line.lineTotal.toString())).toEqual([
      '700000.00',
      '29.99',
    ]);
    expect(totals.subtotal.toString()).toBe('700029.99');
  });

  it('el subtotal suma los line_total ya redondeados', () => {
    // 0.05 × 0.5 = 0.025 → 0.03 por línea. Dos líneas suman 0.06; sumar sin
    // redondear primero daría 0.05.
    const totals = calculator('0').calculate([
      { quantity: '0.5', unitPrice: '0.05' },
      { quantity: '0.5', unitPrice: '0.05' },
    ]);

    expect(totals.lines.map((line) => line.lineTotal.toString())).toEqual([
      '0.03',
      '0.03',
    ]);
    expect(totals.subtotal.toString()).toBe('0.06');
  });

  it('el valor unitario se redondea a 2 decimales (numeric(14,2))', () => {
    const totals = calculator('0').calculate([
      { quantity: '3', unitPrice: '0.333' },
    ]);
    expect(totals.lines[0].lineTotal.toString()).toBe('0.99');
  });

  it('acepta un valor unitario de 0 (RN-03: mayor o igual a 0)', () => {
    const totals = calculator('0.19').calculate([
      { quantity: '1', unitPrice: '0' },
    ]);
    expect(totals.total.toString()).toBe('0.00');
  });

  it('una lista vacía da totales en cero; que sea inválida lo decide RN-03', () => {
    const totals = calculator('0.19').calculate([]);
    expect(totals.subtotal.isZero()).toBe(true);
    expect(totals.total.isZero()).toBe(true);
  });

  it.each(['0', '0.00', '-1', 'abc', '', '1e2'])(
    'rechaza la cantidad "%s"',
    (quantity) => {
      expect(() =>
        calculator('0.19').calculate([{ quantity, unitPrice: '100' }]),
      ).toThrow(RangeError);
    },
  );

  it.each(['-1', 'abc', '', '1,5'])(
    'rechaza el valor unitario "%s"',
    (unitPrice) => {
      expect(() =>
        calculator('0.19').calculate([{ quantity: '1', unitPrice }]),
      ).toThrow(RangeError);
    },
  );

  describe('propiedades (contrato, sección 11.3)', () => {
    const item = fc.record({
      quantity: fc
        .integer({ min: 1, max: 100_000 })
        .map((hundredths) => (hundredths / 100).toFixed(2)),
      unitPrice: fc
        .integer({ min: 0, max: 100_000_000 })
        .map((cents) => (cents / 100).toFixed(2)),
    });
    const items = fc.array(item, { minLength: 1, maxLength: 10 });
    const rate = fc.constantFrom('0', '0.05', '0.19', '0.1925', '1');

    it('total = subtotal + tax_amount', () => {
      fc.assert(
        fc.property(items, rate, (list, r) => {
          const t = calculator(r).calculate(list);
          expect(t.total.equals(t.subtotal.add(t.taxAmount))).toBe(true);
        }),
      );
    });

    it('subtotal es la suma de los line_total', () => {
      fc.assert(
        fc.property(items, rate, (list, r) => {
          const t = calculator(r).calculate(list);
          const sum = t.lines.reduce(
            (acc, line) => acc.add(line.lineTotal),
            Money.zero(),
          );
          expect(t.subtotal.equals(sum)).toBe(true);
        }),
      );
    });

    it('con TAX_RATE = 0, total = subtotal', () => {
      fc.assert(
        fc.property(items, (list) => {
          const t = calculator('0').calculate(list);
          expect(t.total.equals(t.subtotal)).toBe(true);
          expect(t.taxAmount.isZero()).toBe(true);
        }),
      );
    });

    it('ningún resultado tiene más de 2 decimales', () => {
      fc.assert(
        fc.property(items, rate, (list, r) => {
          const t = calculator(r).calculate(list);
          const results = [
            t.subtotal,
            t.taxAmount,
            t.total,
            ...t.lines.map((line) => line.lineTotal),
          ];
          for (const money of results) {
            expect(money.toString()).toMatch(/^\d+\.\d{2}$/);
          }
        }),
      );
    });
  });
});
