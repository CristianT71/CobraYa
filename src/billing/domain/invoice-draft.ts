import { InvoiceCalculator, type InvoiceTotals } from './invoice-calculator';
import {
  assertWithinLimit,
  initialStatus,
  resolvePaymentAmount,
  shouldIssueReceipt,
  validateItems,
  type PaymentMethod,
  type RawItem,
} from './invoice-rules';
import {
  assertPayable,
  InvoiceStatus,
  transition,
} from './invoice-status.enum';
import { Money } from './money';
import { TaxCalculator } from './tax-calculator';

// Decisiones de crear y pagar una cuenta, sin tocar la base de datos. Los casos
// de uso (CreateInvoice, RegisterPayment) solo tienen que persistir el resultado
// en una transacción.

export interface PaymentInput {
  method: PaymentMethod;
  // Vacío → el código usa el total (RN-06).
  amount: string | null;
}

export interface InvoiceDraftInput {
  items: readonly RawItem[];
  payment: PaymentInput | null;
}

export interface InvoiceDraftConfig {
  taxRate: string;
  maxInvoiceTotal: string;
}

export interface PaymentPlan {
  method: PaymentMethod;
  amount: Money;
  status: 'APPLIED';
}

export interface InvoiceDraft {
  status: InvoiceStatus;
  totals: InvoiceTotals;
  payment: PaymentPlan | null;
  issueReceipt: boolean;
}

// Crear una cuenta: RN-03 → cálculo → RN-04 → RN-06 → RN-05 → RN-09.
export function buildInvoiceDraft(
  input: InvoiceDraftInput,
  config: InvoiceDraftConfig,
): InvoiceDraft {
  validateItems(input.items);

  const totals = new InvoiceCalculator(
    new TaxCalculator(config.taxRate),
  ).calculate(input.items);
  assertWithinLimit(totals.total, Money.of(config.maxInvoiceTotal));

  const payment = input.payment
    ? paymentPlan(input.payment, totals.total)
    : null;
  const status = initialStatus(payment);

  return { status, totals, payment, issueReceipt: shouldIssueReceipt(status) };
}

export interface PaymentDecision {
  payment: PaymentPlan;
  newStatus: InvoiceStatus;
  issueReceipt: boolean;
}

// Pagar una cuenta existente: RN-07 → RN-06 → PENDING → PAID → RN-09.
export function planPayment(
  currentStatus: InvoiceStatus,
  total: Money,
  input: PaymentInput,
): PaymentDecision {
  assertPayable(currentStatus);

  const payment = paymentPlan(input, total);
  const newStatus = transition(currentStatus, InvoiceStatus.PAID);

  return { payment, newStatus, issueReceipt: shouldIssueReceipt(newStatus) };
}

function paymentPlan(input: PaymentInput, total: Money): PaymentPlan {
  return {
    method: input.method,
    amount: resolvePaymentAmount(total, input.amount),
    status: 'APPLIED',
  };
}
