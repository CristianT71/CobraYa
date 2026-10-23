import Decimal from 'decimal.js';

// Value object de dinero (contrato, sección 8.1): decimal.js con redondeo
// half-up a 2 decimales, aplicado una vez por cada resultado. Moneda única: COP.

const MONEY_SCALE = 2;

// Constructor propio para no depender de la configuración global de Decimal.
const Dec = Decimal.clone({
  precision: 40,
  rounding: Decimal.ROUND_HALF_UP,
});

const DECIMAL_REGEX = /^-?\d+(\.\d+)?$/;

type Factor = string | Money;

export class Money {
  private constructor(private readonly value: Decimal) {}

  static zero(): Money {
    return new Money(new Dec(0));
  }

  // Texto decimal ("80000", "350000.50"). Redondea half-up a 2 decimales.
  static of(value: string): Money {
    return new Money(Money.round(Money.parse(value)));
  }

  static sum(values: Iterable<Money>): Money {
    let total = new Dec(0);
    for (const money of values) {
      total = total.plus(money.value);
    }
    return new Money(total);
  }

  add(other: Money): Money {
    return new Money(this.value.plus(other.value));
  }

  subtract(other: Money): Money {
    return new Money(this.value.minus(other.value));
  }

  // Multiplica por una cantidad o una tasa y redondea una sola vez.
  multiply(factor: Factor): Money {
    const decimal =
      factor instanceof Money ? factor.value : Money.parse(factor);
    return new Money(Money.round(this.value.times(decimal)));
  }

  equals(other: Money): boolean {
    return this.value.equals(other.value);
  }

  isGreaterThan(other: Money): boolean {
    return this.value.greaterThan(other.value);
  }

  isLessThan(other: Money): boolean {
    return this.value.lessThan(other.value);
  }

  isZero(): boolean {
    return this.value.isZero();
  }

  isNegative(): boolean {
    return this.value.isNegative() && !this.value.isZero();
  }

  // Siempre con 2 decimales: "124950.00".
  toString(): string {
    return this.value.toFixed(MONEY_SCALE, Dec.ROUND_HALF_UP);
  }

  toJSON(): string {
    return this.toString();
  }

  private static parse(value: string): Decimal {
    if (typeof value !== 'string' || !DECIMAL_REGEX.test(value)) {
      throw new RangeError(`Valor decimal inválido: "${String(value)}"`);
    }
    return new Dec(value);
  }

  private static round(value: Decimal): Decimal {
    return value.toDecimalPlaces(MONEY_SCALE, Dec.ROUND_HALF_UP);
  }
}
