import { InvoiceNotPayableError } from '../../../src/billing/domain/billing.errors';
import {
  assertPayable,
  canTransition,
  InvoiceStatus,
  isFinalStatus,
  transition,
} from '../../../src/billing/domain/invoice-status.enum';

const { PENDING, PAID, CANCELLED } = InvoiceStatus;

describe('InvoiceStatus', () => {
  it('usa los valores del contrato', () => {
    expect(Object.values(InvoiceStatus)).toEqual([
      'PENDING',
      'PAID',
      'CANCELLED',
    ]);
  });

  describe('transiciones (sección 8.3)', () => {
    it.each([
      [PENDING, PAID, true],
      [PENDING, CANCELLED, true],
      [PENDING, PENDING, false],
      [PAID, PENDING, false],
      [PAID, PAID, false],
      [PAID, CANCELLED, false],
      [CANCELLED, PENDING, false],
      [CANCELLED, PAID, false],
      [CANCELLED, CANCELLED, false],
    ])('%s → %s permitida: %s', (from, to, allowed) => {
      expect(canTransition(from, to)).toBe(allowed);
    });

    it('PAID y CANCELLED son estados finales', () => {
      expect(isFinalStatus(PAID)).toBe(true);
      expect(isFinalStatus(CANCELLED)).toBe(true);
      expect(isFinalStatus(PENDING)).toBe(false);
    });

    it('transition devuelve el estado destino cuando es válida', () => {
      expect(transition(PENDING, PAID)).toBe(PAID);
    });

    it('transition lanza INTERNAL_ERROR cuando no existe la transición', () => {
      expect(() => transition(PAID, PENDING)).toThrow(
        expect.objectContaining({ code: 'INTERNAL_ERROR' }),
      );
    });
  });

  describe('RN-07: solo una cuenta PENDING admite pago', () => {
    it('acepta una cuenta PENDING', () => {
      expect(() => assertPayable(PENDING)).not.toThrow();
    });

    it.each([PAID, CANCELLED])(
      'una cuenta %s se rechaza con INVOICE_NOT_PAYABLE',
      (status) => {
        const attempt = () => assertPayable(status);
        expect(attempt).toThrow(InvoiceNotPayableError);
        expect(attempt).toThrow(
          expect.objectContaining({ code: 'INVOICE_NOT_PAYABLE', status }),
        );
      },
    );
  });
});
