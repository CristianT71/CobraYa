import { amountInWords } from '../../../src/receipts/amount-in-words';

describe('amountInWords', () => {
  it.each([
    ['0.00', 'CERO PESOS M/CTE'],
    ['1.00', 'UN PESO M/CTE'],
    ['21.00', 'VEINTIÚN PESOS M/CTE'],
    ['31.00', 'TREINTA Y UN PESOS M/CTE'],
    ['100.00', 'CIEN PESOS M/CTE'],
    ['101.00', 'CIENTO UN PESOS M/CTE'],
    ['999.00', 'NOVECIENTOS NOVENTA Y NUEVE PESOS M/CTE'],
    ['1000.00', 'MIL PESOS M/CTE'],
    ['1001.00', 'MIL UN PESOS M/CTE'],
    ['21000.00', 'VEINTIÚN MIL PESOS M/CTE'],
    ['95200.00', 'NOVENTA Y CINCO MIL DOSCIENTOS PESOS M/CTE'],
    ['124950.00', 'CIENTO VEINTICUATRO MIL NOVECIENTOS CINCUENTA PESOS M/CTE'],
    ['1000000.00', 'UN MILLÓN DE PESOS M/CTE'],
    ['1000001.00', 'UN MILLÓN UN PESOS M/CTE'],
    ['2000000.00', 'DOS MILLONES DE PESOS M/CTE'],
    ['12500000.00', 'DOCE MILLONES QUINIENTOS MIL PESOS M/CTE'],
    [
      '15303400.00',
      'QUINCE MILLONES TRESCIENTOS TRES MIL CUATROCIENTOS PESOS M/CTE',
    ],
    ['50000000.00', 'CINCUENTA MILLONES DE PESOS M/CTE'],
    ['1000000000.00', 'MIL MILLONES DE PESOS M/CTE'],
  ])('%s -> %s', (input, expected) => {
    expect(amountInWords(input)).toBe(expected);
  });

  it('agrega los centavos cuando los hay', () => {
    expect(amountInWords('95200.50')).toBe(
      'NOVENTA Y CINCO MIL DOSCIENTOS PESOS CON 50/100 M/CTE',
    );
    expect(amountInWords('0.05')).toBe('CERO PESOS CON 05/100 M/CTE');
  });
});
