import {
  AmbiguousCustomerError,
  CustomerNotFoundError,
  InvalidAmountError,
  InvoiceNotPayableError,
  MissingFieldsError,
  PaymentMismatchError,
  TotalExceedsLimitError,
  UnknownIntentError,
} from '../../../src/billing/domain/billing.errors';
import {
  assertKnownIntent,
  assertReceiptLookup,
  assertWithinLimit,
  initialStatus,
  MAX_DESCRIPTION_LENGTH,
  resolveCustomer,
  resolveInvoiceToPay,
  resolvePaymentAmount,
  shouldIssueReceipt,
  validateItems,
} from '../../../src/billing/domain/invoice-rules';
import {
  assertPayable,
  InvoiceStatus,
} from '../../../src/billing/domain/invoice-status.enum';
import { Money } from '../../../src/billing/domain/money';

const item = {
  description: 'Cambio de aceite',
  quantity: '1',
  unitPrice: '80000',
};

describe('RN-01 y RN-02: resolveCustomer', () => {
  it('RN-01: sin coincidencias lanza CUSTOMER_NOT_FOUND', () => {
    expect(() => resolveCustomer([])).toThrow(CustomerNotFoundError);
  });

  it('RN-02: varios clientes con el mismo número piden aclarar el tipo', () => {
    const attempt = () => resolveCustomer([{ id: 'a' }, { id: 'b' }]);
    expect(attempt).toThrow(AmbiguousCustomerError);
    expect(attempt).toThrow(
      expect.objectContaining({ missingFields: ['customer.document_type'] }),
    );
  });

  it('con exactamente un cliente lo devuelve', () => {
    expect(resolveCustomer([{ id: 'a' }])).toEqual({ id: 'a' });
  });
});

describe('RN-03: validateItems', () => {
  it('acepta ítems válidos, incluido un valor unitario de 0', () => {
    expect(() =>
      validateItems([item, { ...item, unitPrice: '0' }]),
    ).not.toThrow();
  });

  it('una lista vacía pide items', () => {
    expect(() => validateItems([])).toThrow(
      expect.objectContaining({
        code: 'MISSING_FIELDS',
        missingFields: ['items'],
      }),
    );
  });

  it('una descripción vacía o solo con espacios pide la descripción', () => {
    for (const description of ['', '   ']) {
      expect(() => validateItems([{ ...item, description }])).toThrow(
        expect.objectContaining({
          missingFields: ['items[0].description'],
        }),
      );
    }
  });

  it(`rechaza descripciones de más de ${MAX_DESCRIPTION_LENGTH} caracteres`, () => {
    const long = 'a'.repeat(MAX_DESCRIPTION_LENGTH + 1);
    expect(() => validateItems([{ ...item, description: long }])).toThrow(
      MissingFieldsError,
    );
    expect(() =>
      validateItems([
        { ...item, description: 'a'.repeat(MAX_DESCRIPTION_LENGTH) },
      ]),
    ).not.toThrow();
  });

  it.each(['0', '0.00', '-1', 'abc', '', '1.234'])(
    'rechaza la cantidad "%s"',
    (quantity) => {
      expect(() => validateItems([{ ...item, quantity }])).toThrow(
        expect.objectContaining({
          code: 'INVALID_AMOUNT',
          missingFields: ['items[0].quantity'],
        }),
      );
    },
  );

  it.each(['-1', 'abc', '', '1,5', '1.234'])(
    'rechaza el valor unitario "%s"',
    (unitPrice) => {
      expect(() => validateItems([{ ...item, unitPrice }])).toThrow(
        expect.objectContaining({
          code: 'INVALID_AMOUNT',
          missingFields: ['items[0].unit_price'],
        }),
      );
    },
  );

  it('indica el índice del ítem que falla', () => {
    expect(() =>
      validateItems([item, item, { ...item, quantity: '0' }]),
    ).toThrow(
      expect.objectContaining({ missingFields: ['items[2].quantity'] }),
    );
  });
});

describe('RN-04: assertWithinLimit', () => {
  const limit = Money.of('50000000');

  it('acepta un total igual o menor al límite', () => {
    expect(() => assertWithinLimit(Money.of('50000000'), limit)).not.toThrow();
    expect(() => assertWithinLimit(Money.of('1'), limit)).not.toThrow();
  });

  it('un total mayor lanza TOTAL_EXCEEDS_LIMIT', () => {
    expect(() => assertWithinLimit(Money.of('50000000.01'), limit)).toThrow(
      TotalExceedsLimitError,
    );
  });
});

describe('RN-05: initialStatus', () => {
  it('con pago la cuenta nace PAID', () => {
    expect(initialStatus({ method: 'cash', amount: null })).toBe(
      InvoiceStatus.PAID,
    );
  });

  it('sin pago la cuenta nace PENDING', () => {
    expect(initialStatus(null)).toBe(InvoiceStatus.PENDING);
  });
});

describe('RN-06: resolvePaymentAmount', () => {
  const total = Money.of('124950.00');

  it('un monto vacío usa el total', () => {
    expect(resolvePaymentAmount(total, null).toString()).toBe('124950.00');
  });

  it('acepta un monto igual al total, sin importar el formato', () => {
    expect(resolvePaymentAmount(total, '124950').toString()).toBe('124950.00');
  });

  it.each(['100000', '124950.01', '0'])(
    'un monto distinto (%s) lanza PAYMENT_MISMATCH',
    (amount) => {
      expect(() => resolvePaymentAmount(total, amount)).toThrow(
        PaymentMismatchError,
      );
    },
  );

  it('un monto con formato inválido lanza INVALID_AMOUNT', () => {
    expect(() => resolvePaymentAmount(total, '124,950')).toThrow(
      InvalidAmountError,
    );
  });
});

describe('RN-07: assertPayable', () => {
  it.each([InvoiceStatus.PAID, InvoiceStatus.CANCELLED])(
    'una cuenta %s no admite pago',
    (status) => {
      expect(() => assertPayable(status)).toThrow(InvoiceNotPayableError);
    },
  );
});

describe('RN-08: resolveInvoiceToPay', () => {
  it('con invoice_id lo usa sin mirar las pendientes', () => {
    expect(resolveInvoiceToPay('inv-1', [])).toBe('inv-1');
    expect(resolveInvoiceToPay('inv-1', ['a', 'b'])).toBe('inv-1');
  });

  it('sin invoice_id usa la única cuenta PENDING', () => {
    expect(resolveInvoiceToPay(null, ['inv-9'])).toBe('inv-9');
  });

  it.each([[[]], [['a', 'b']]])(
    'sin invoice_id y con %j cuentas pendientes pide el invoice_id',
    (pending) => {
      expect(() => resolveInvoiceToPay(null, pending)).toThrow(
        expect.objectContaining({
          code: 'MISSING_FIELDS',
          missingFields: ['related_ids.invoice_id'],
        }),
      );
    },
  );
});

describe('RN-09: shouldIssueReceipt', () => {
  it('solo se emite comprobante cuando la cuenta está PAID', () => {
    expect(shouldIssueReceipt(InvoiceStatus.PAID)).toBe(true);
    expect(shouldIssueReceipt(InvoiceStatus.PENDING)).toBe(false);
    expect(shouldIssueReceipt(InvoiceStatus.CANCELLED)).toBe(false);
  });
});

describe('RN-10: assertReceiptLookup', () => {
  it('sin receipt_number ni invoice_id pide el dato', () => {
    expect(() => assertReceiptLookup(null, null)).toThrow(
      expect.objectContaining({
        code: 'MISSING_FIELDS',
        missingFields: ['related_ids.receipt_number'],
      }),
    );
  });

  it('basta con uno de los dos', () => {
    expect(() => assertReceiptLookup(15, null)).not.toThrow();
    expect(() => assertReceiptLookup(null, 'inv-1')).not.toThrow();
  });
});

describe('RN-11: assertKnownIntent', () => {
  it('la intención unknown no ejecuta nada', () => {
    expect(() => assertKnownIntent('unknown')).toThrow(UnknownIntentError);
  });

  it.each(['create_invoice', 'register_payment', 'get_receipt'])(
    'acepta %s',
    (intent) => {
      expect(() => assertKnownIntent(intent)).not.toThrow();
    },
  );
});
