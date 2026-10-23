import {
  InvalidStatusTransitionError,
  InvoiceNotPayableError,
} from './billing.errors';

// Estados de la cuenta de cobro y sus transiciones (contrato, sección 8.3).
// PAID y CANCELLED son finales. CANCELLED está reservado para uso futuro: no
// hay endpoint de anulación en esta versión.

export enum InvoiceStatus {
  PENDING = 'PENDING',
  PAID = 'PAID',
  CANCELLED = 'CANCELLED',
}

const TRANSITIONS: Readonly<Record<InvoiceStatus, readonly InvoiceStatus[]>> = {
  [InvoiceStatus.PENDING]: [InvoiceStatus.PAID, InvoiceStatus.CANCELLED],
  [InvoiceStatus.PAID]: [],
  [InvoiceStatus.CANCELLED]: [],
};

export function isFinalStatus(status: InvoiceStatus): boolean {
  return TRANSITIONS[status].length === 0;
}

export function canTransition(from: InvoiceStatus, to: InvoiceStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

// Devuelve el estado destino o lanza si la transición no existe.
export function transition(
  from: InvoiceStatus,
  to: InvoiceStatus,
): InvoiceStatus {
  if (!canTransition(from, to)) {
    throw new InvalidStatusTransitionError(from, to);
  }
  return to;
}

// RN-07: solo una cuenta PENDING admite pago.
export function assertPayable(status: InvoiceStatus): void {
  if (status !== InvoiceStatus.PENDING) {
    throw new InvoiceNotPayableError(status);
  }
}
