import fc from 'fast-check';
import { Money } from '../../../src/billing/domain/money';

describe('Money', () => {
  describe('creación', () => {
    it('guarda siempre 2 decimales', () => {
      expect(Money.of('80000').toString()).toBe('80000.00');
      expect(Money.of('350000.5').toString()).toBe('350000.50');
      expect(Money.zero().toString()).toBe('0.00');
    });

    it('redondea half-up a 2 decimales', () => {
      expect(Money.of('10.005').toString()).toBe('10.01');
      expect(Money.of('10.004').toString()).toBe('10.00');
      expect(Money.of('0.125').toString()).toBe('0.13');
    });

    it.each(['', 'abc', '1,5', '1e5', ' 10', '10 ', '--1', '.5', '5.'])(
      'rechaza el texto "%s"',
      (value) => {
        expect(() => Money.of(value)).toThrow(RangeError);
      },
    );

    it('rechaza valores que no son texto', () => {
      expect(() => Money.of(10.5 as unknown as string)).toThrow(RangeError);
    });
  });

  describe('suma', () => {
    it('suma sin error de punto flotante', () => {
      expect(Money.of('0.10').add(Money.of('0.20')).toString()).toBe('0.30');
    });

    it('suma el ejemplo del contrato (80.000 + 25.000)', () => {
      expect(Money.sum([Money.of('80000'), Money.of('25000')]).toString()).toBe(
        '105000.00',
      );
    });

    it('la suma de una lista vacía es cero', () => {
      expect(Money.sum([]).isZero()).toBe(true);
    });

    it('no modifica los operandos', () => {
      const a = Money.of('1.00');
      a.add(Money.of('2.00'));
      expect(a.toString()).toBe('1.00');
    });
  });

  describe('multiplicación', () => {
    it('calcula line_total = cantidad × precio unitario', () => {
      expect(Money.of('350000.00').multiply('2').toString()).toBe('700000.00');
      expect(Money.of('19.99').multiply('1.5').toString()).toBe('29.99');
    });

    it('calcula el impuesto del contrato: 105000.00 × 0.19 = 19950.00', () => {
      expect(Money.of('105000.00').multiply('0.19').toString()).toBe(
        '19950.00',
      );
    });

    it('redondea half-up una sola vez, al final', () => {
      // 0.05 × 0.5 = 0.025 → 0.03 (half-up), no 0.02 (half-even).
      expect(Money.of('0.05').multiply('0.5').toString()).toBe('0.03');
    });

    it('multiplicar por 0 da 0.00', () => {
      expect(Money.of('124950.00').multiply('0').toString()).toBe('0.00');
    });

    it('acepta otro Money como factor', () => {
      expect(Money.of('10.00').multiply(Money.of('2.50')).toString()).toBe(
        '25.00',
      );
    });

    it('rechaza factores que no son decimales', () => {
      expect(() => Money.of('1').multiply('abc')).toThrow(RangeError);
    });
  });

  describe('resta y comparación', () => {
    it('resta', () => {
      expect(Money.of('10.00').subtract(Money.of('2.50')).toString()).toBe(
        '7.50',
      );
    });

    it('compara por valor, no por referencia', () => {
      expect(Money.of('124950').equals(Money.of('124950.00'))).toBe(true);
      expect(Money.of('1').isLessThan(Money.of('2'))).toBe(true);
      expect(Money.of('2').isGreaterThan(Money.of('1'))).toBe(true);
      expect(Money.of('2').isGreaterThan(Money.of('2'))).toBe(false);
    });

    it('detecta negativos y cero', () => {
      expect(Money.of('-1.00').isNegative()).toBe(true);
      expect(Money.of('0').isNegative()).toBe(false);
      expect(Money.of('-0.001').isZero()).toBe(true);
      expect(Money.of('-0.001').isNegative()).toBe(false);
    });
  });

  describe('serialización', () => {
    it('se serializa a JSON como texto con 2 decimales', () => {
      expect(JSON.stringify({ total: Money.of('124950') })).toBe(
        '{"total":"124950.00"}',
      );
    });
  });

  describe('propiedades', () => {
    const amount = fc
      .integer({ min: 0, max: 99_999_999_999 })
      .map((cents) => (cents / 100).toFixed(2));

    it('nunca produce más de 2 decimales', () => {
      fc.assert(
        fc.property(amount, amount, (a, b) => {
          const decimals = (m: Money) => m.toString().split('.')[1];
          expect(decimals(Money.of(a).add(Money.of(b)))).toHaveLength(2);
          expect(decimals(Money.of(a).multiply('0.19'))).toHaveLength(2);
        }),
      );
    });

    it('la suma es exacta y conmutativa', () => {
      fc.assert(
        fc.property(amount, amount, (a, b) => {
          const left = Money.of(a).add(Money.of(b));
          const right = Money.of(b).add(Money.of(a));
          expect(left.equals(right)).toBe(true);
          expect(left.subtract(Money.of(b)).equals(Money.of(a))).toBe(true);
        }),
      );
    });
  });
});
