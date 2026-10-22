import Decimal from 'decimal.js';
import { Money } from './money';

// Impuesto (contrato, sección 8.1): tax_amount = round(subtotal × tax_rate, 2).
// La tasa llega ya leída de TAX_RATE (0.19, o 0 para desactivar el impuesto);
// el dominio no lee variables de entorno. Se guarda en cada cuenta con 4
// decimales (numeric(5,4)), así que un cambio posterior no altera las emitidas.

const RATE_REGEX = /^\d+(\.\d{1,4})?$/;
const RATE_SCALE = 4;

export class TaxCalculator {
  private readonly rateValue: Decimal;

  constructor(rate: string) {
    if (typeof rate !== 'string' || !RATE_REGEX.test(rate)) {
      throw new RangeError(
        `Tasa de impuesto inválida: "${String(rate)}" (decimal con hasta 4 decimales)`,
      );
    }
    const value = new Decimal(rate);
    if (value.greaterThan(1)) {
      throw new RangeError(
        `La tasa de impuesto debe estar entre 0 y 1: "${rate}"`,
      );
    }
    this.rateValue = value;
  }

  // Tal como se guarda en invoices.tax_rate: "0.1900".
  get rate(): string {
    return this.rateValue.toFixed(RATE_SCALE);
  }

  taxFor(subtotal: Money): Money {
    return subtotal.multiply(this.rate);
  }
}
