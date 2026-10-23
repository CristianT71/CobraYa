import { EntityManager } from 'typeorm';
import { Invoice } from '../entities/invoice.entity';

/**
 * Bloquea la fila de la cuenta hasta que termine la transacción (FOR UPDATE).
 * Se carga sin relaciones a propósito: PostgreSQL no permite FOR UPDATE
 * sobre el lado opcional de un LEFT JOIN. Los ítems y pagos se leen después.
 */
export function lockInvoiceById(
  manager: EntityManager,
  invoiceId: string,
): Promise<Invoice | null> {
  return manager.getRepository(Invoice).findOne({
    where: { id: invoiceId },
    lock: { mode: 'pessimistic_write' },
  });
}
