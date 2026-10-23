import { formatCop, formatRate } from '../../../src/receipts/format-cop';

describe('formatCop', () => {
  it.each([
    ['0.00', '$0'],
    ['5.00', '$5'],
    ['950.00', '$950'],
    ['95200.00', '$95.200'],
    ['12500000.00', '$12.500.000'],
    ['95200.50', '$95.200,50'],
    ['0.05', '$0,05'],
    ['124950.00', '$124.950'],
  ])('%s -> %s', (input, expected) => {
    expect(formatCop(input)).toBe(expected);
  });

  it('no pierde precisión con montos que number no representa bien', () => {
    expect(formatCop('50000000000.07')).toBe('$50.000.000.000,07');
  });
});

describe('formatRate', () => {
  it.each([
    ['0.1900', '19 %'],
    ['0.0000', '0 %'],
    ['0.0550', '5,5 %'],
    ['0.0525', '5,25 %'],
    ['1.0000', '100 %'],
  ])('%s -> %s', (input, expected) => {
    expect(formatRate(input)).toBe(expected);
  });
});
