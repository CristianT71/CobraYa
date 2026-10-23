import {
  AmbiguousCustomerError,
  BillingError,
  CustomerNotFoundError,
  InvalidAmountError,
  InvalidStatusTransitionError,
  InvoiceNotFoundError,
  InvoiceNotPayableError,
  MissingFieldsError,
  PaymentMismatchError,
  ReceiptNotFoundError,
  TotalExceedsLimitError,
  UnknownIntentError,
} from '../../../src/billing/domain/billing.errors';
import { InvoiceStatus } from '../../../src/billing/domain/invoice-status.enum';
import { Money } from '../../../src/billing/domain/money';
import {
  ERROR_CATALOG,
  isCatalogError,
} from '../../../src/common/errors/error-catalog';

const errors: Array<[string, BillingError, string, string]> = [
  [
    'CustomerNotFoundError',
    new CustomerNotFoundError(),
    'CUSTOMER_NOT_FOUND',
    'rejected',
  ],
  [
    'AmbiguousCustomerError',
    new AmbiguousCustomerError(),
    'AMBIGUOUS_CUSTOMER',
    'needs_clarification',
  ],
  [
    'MissingFieldsError',
    new MissingFieldsError(['items']),
    'MISSING_FIELDS',
    'needs_clarification',
  ],
  [
    'UnknownIntentError',
    new UnknownIntentError(),
    'UNKNOWN_INTENT',
    'needs_clarification',
  ],
  [
    'InvalidAmountError',
    new InvalidAmountError(),
    'INVALID_AMOUNT',
    'needs_clarification',
  ],
  [
    'TotalExceedsLimitError',
    new TotalExceedsLimitError(Money.of('60000000'), Money.of('50000000')),
    'TOTAL_EXCEEDS_LIMIT',
    'rejected',
  ],
  [
    'PaymentMismatchError',
    new PaymentMismatchError(Money.of('124950'), Money.of('100000')),
    'PAYMENT_MISMATCH',
    'rejected',
  ],
  [
    'InvoiceNotPayableError',
    new InvoiceNotPayableError(InvoiceStatus.PAID),
    'INVOICE_NOT_PAYABLE',
    'rejected',
  ],
  [
    'InvoiceNotFoundError',
    new InvoiceNotFoundError(),
    'INVOICE_NOT_FOUND',
    'rejected',
  ],
  [
    'ReceiptNotFoundError',
    new ReceiptNotFoundError(),
    'RECEIPT_NOT_FOUND',
    'rejected',
  ],
  [
    'InvalidStatusTransitionError',
    new InvalidStatusTransitionError(InvoiceStatus.PAID, InvoiceStatus.PENDING),
    'INTERNAL_ERROR',
    'error',
  ],
];

describe('errores de dominio de billing', () => {
  it.each(errors)(
    '%s tiene el código %s del catálogo y el estado %s',
    (_name, error, code, status) => {
      expect(error).toBeInstanceOf(BillingError);
      expect(error).toBeInstanceOf(Error);
      expect(error.code).toBe(code);
      expect(ERROR_CATALOG[error.code].status).toBe(status);
    },
  );

  it.each(errors)(
    '%s lo reconoce el filtro global (isCatalogError)',
    (_n, error) => {
      expect(isCatalogError(error)).toBe(true);
    },
  );

  it('el nombre de cada error es el de su clase', () => {
    expect(new CustomerNotFoundError().name).toBe('CustomerNotFoundError');
    expect(new PaymentMismatchError(Money.of('1'), Money.of('2')).name).toBe(
      'PaymentMismatchError',
    );
  });

  it('MissingFieldsError expone los campos que faltan', () => {
    const error = new MissingFieldsError(['customer.document_number', 'items']);
    expect(error.missingFields).toEqual(['customer.document_number', 'items']);
    expect(error.message).toContain('customer.document_number');
  });

  it('AmbiguousCustomerError pide el tipo de documento', () => {
    expect(new AmbiguousCustomerError().missingFields).toEqual([
      'customer.document_type',
    ]);
  });

  it('los errores sin campos faltantes traen missingFields vacío', () => {
    expect(new CustomerNotFoundError().missingFields).toEqual([]);
  });

  it('TotalExceedsLimitError y PaymentMismatchError muestran los montos con 2 decimales', () => {
    const exceeds = new TotalExceedsLimitError(
      Money.of('60000000'),
      Money.of('50000000'),
    );
    expect(exceeds.message).toContain('60000000.00');
    expect(exceeds.message).toContain('50000000.00');
    expect(exceeds.total.toString()).toBe('60000000.00');

    const mismatch = new PaymentMismatchError(
      Money.of('124950'),
      Money.of('100000'),
    );
    expect(mismatch.message).toContain('124950.00');
    expect(mismatch.message).toContain('100000.00');
  });

  it('InvoiceNotPayableError indica el estado actual de la cuenta', () => {
    const error = new InvoiceNotPayableError(InvoiceStatus.CANCELLED);
    expect(error.status).toBe(InvoiceStatus.CANCELLED);
    expect(error.message).toContain('CANCELLED');
  });
});
