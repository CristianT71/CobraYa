import Decimal from 'decimal.js';
import { Money } from './money';
import type { TaxCalculator } from './tax-calculator';

// Totales de una cuenta (contrato, sección 8.1):
//   line_total = quantity × unit_price
//   subtotal   = Σ line_total
//   tax_amount = round(subtotal × tax_rate, 2)
//   total      = subtotal + tax_amount
// Cantidades y precios llegan como texto decimal: nunca number flotante.

const DECIMAL_REGEX = /^\d+(\.\d+)?$/;

export interface InvoiceItemInput {
  quantity: string;
  unitPrice: string;
}

export interface CalculatedLine {
  quantity: string;
  unitPrice: string;
  lineTotal: Money;
}

export interface InvoiceTotals {
  lines: CalculatedLine[];
  subtotal: Money;
  taxRate: string;
  taxAmount: Money;
  total: Money;
}

export class InvoiceCalculator {
  constructor(private readonly tax: TaxCalculator) {}

  calculate(items: readonly InvoiceItemInput[]): InvoiceTotals {
    const lines = items.map((item) => this.line(item));
    const subtotal = Money.sum(lines.map((line) => line.lineTotal));
    const taxAmount = this.tax.taxFor(subtotal);

    return {
      lines,
      subtotal,
      taxRate: this.tax.rate,
      taxAmount,
      total: subtotal.add(taxAmount),
    };
  }

  private line(item: InvoiceItemInput): CalculatedLine {
    // RN-03: cantidad mayor que 0 y valor unitario mayor o igual a 0. Aquí solo
    // se protege el cálculo; el rechazo de negocio vive en las reglas del dominio.
    if (
      !DECIMAL_REGEX.test(item.quantity) ||
      new Decimal(item.quantity).lte(0)
    ) {
      throw new RangeError(`Cantidad inválida: "${item.quantity}"`);
    }
    if (!DECIMAL_REGEX.test(item.unitPrice)) {
      throw new RangeError(`Valor unitario inválido: "${item.unitPrice}"`);
    }

    return {
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      lineTotal: Money.of(item.unitPrice).multiply(item.quantity),
    };
  }
}
