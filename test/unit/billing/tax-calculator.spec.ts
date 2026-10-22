import { Money } from '../../../src/billing/domain/money';
import { TaxCalculator } from '../../../src/billing/domain/tax-calculator';

describe('TaxCalculator', () => {
  it('calcula el impuesto del contrato: 105000.00 con tasa 0.19 es 19950.00', () => {
    const tax = new TaxCalculator('0.19');
    expect(tax.taxFor(Money.of('105000.00')).toString()).toBe('19950.00');
  });

  it('con tasa 0 el impuesto es 0.00', () => {
    const tax = new TaxCalculator('0');
    expect(tax.taxFor(Money.of('105000.00')).toString()).toBe('0.00');
  });

  it('redondea half-up a 2 decimales', () => {
    // 0.50 × 0.19 = 0.095 → 0.10
    expect(new TaxCalculator('0.19').taxFor(Money.of('0.50')).toString()).toBe(
      '0.10',
    );
    // 0.10 × 0.19 = 0.019 → 0.02
    expect(new TaxCalculator('0.19').taxFor(Money.of('0.10')).toString()).toBe(
      '0.02',
    );
  });

  it('expone la tasa con 4 decimales, como se guarda en invoices.tax_rate', () => {
    expect(new TaxCalculator('0.19').rate).toBe('0.1900');
    expect(new TaxCalculator('0').rate).toBe('0.0000');
    expect(new TaxCalculator('1').rate).toBe('1.0000');
  });

  it.each(['', 'abc', '-0.19', '0.19001', '1.01', '2', '19%', '0,19'])(
    'rechaza la tasa "%s"',
    (rate) => {
      expect(() => new TaxCalculator(rate)).toThrow(RangeError);
    },
  );

  it('rechaza una tasa que no es texto', () => {
    expect(() => new TaxCalculator(0.19 as unknown as string)).toThrow(
      RangeError,
    );
  });
});
