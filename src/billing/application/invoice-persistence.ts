import type { EntityManager } from 'typeorm';
import type { InvoiceResultData } from '../dto/invoice-result.dto';
import { Invoice } from '../entities/invoice.entity';
import { Receipt } from '../entities/receipt.entity';
import { toInvoiceResultData } from '../mappers/invoice-result.mapper';

// Piezas compartidas por los casos de uso que escriben o leen una cuenta
// completa. Reciben el EntityManager de la transacción en curso.

export function loadInvoiceWithRelations(
  manager: EntityManager,
  invoiceId: string,
): Promise<Invoice | null> {
  return manager.getRepository(Invoice).findOne({
    where: { id: invoiceId },
    relations: { customer: true, items: true, payments: true, receipt: true },
  });
}

// RN-09: el comprobante se emite solo cuando la cuenta pasa a PAID. El número
// consecutivo y la fecha los asigna PostgreSQL (receipt_number_seq y now()).
// El payload es la copia del resultado al emitirse; lleva la cédula enmascarada.
export async function issueReceipt(
  manager: EntityManager,
  invoice: Invoice,
): Promise<void> {
  const { receipt: _unissued, ...payload } = toInvoiceResultData(invoice);
  const receipts = manager.getRepository(Receipt);
  await receipts.save(receipts.create({ invoiceId: invoice.id, payload }));
}

export function toResult(invoice: Invoice): InvoiceResultData {
  return toInvoiceResultData(invoice);
}
