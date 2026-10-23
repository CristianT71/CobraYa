import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import { ReceiptNotFoundError } from '../billing/domain/billing.errors';
import { Invoice } from '../billing/entities/invoice.entity';
import { Receipt } from '../billing/entities/receipt.entity';
import { maskDocument } from '../common/utils/mask-document.util';
import { Partner } from '../partners/partner.entity';

// Lo que ve quien verifica un comprobante: lo justo para comprobar que es auténtico.
// Sin nombre del cliente y con el documento enmascarado.
export interface PublicReceiptView {
  receipt_number: number;
  issued_at: string;
  issued_by: string;
  customer_document: string;
  subtotal: string;
  tax_amount: string;
  total: string;
  items: Array<{ description: string; quantity: number; line_total: string }>;
  payment: { method: string; amount: string } | null;
}

const PLATFORM_NAME = 'Facturación y Pagos';

// Verificación pública de comprobantes. El número de comprobante es consecutivo y se
// puede adivinar, así que no basta: hay que presentar también el documento del
// cliente. Un número inexistente y un documento equivocado dan EXACTAMENTE la misma
// respuesta, para que nadie pueda sondear qué comprobantes existen.
@Injectable()
export class PublicReceiptsService {
  constructor(
    @InjectRepository(Receipt) private readonly receipts: Repository<Receipt>,
    @InjectRepository(Invoice) private readonly invoices: Repository<Invoice>,
    @InjectRepository(Partner) private readonly partners: Repository<Partner>,
  ) {}

  async verify(
    receiptNumber: number,
    documentNumber: string,
  ): Promise<PublicReceiptView> {
    const digits = documentNumber.replace(/\D/g, '');
    const receipt = await this.receipts.findOneBy({ receiptNumber });
    const invoice = receipt
      ? await this.invoices.findOne({
          where: { id: receipt.invoiceId },
          relations: { customer: true, items: true, payments: true },
        })
      : null;

    if (!receipt || !invoice || invoice.customer.documentNumber !== digits) {
      throw new ReceiptNotFoundError(
        'No encontramos un comprobante con esos datos.',
      );
    }

    const partner = invoice.partnerId
      ? await this.partners.findOneBy({ id: invoice.partnerId })
      : null;
    const payment = invoice.payments[0] ?? null;

    return {
      receipt_number: receipt.receiptNumber,
      issued_at: receipt.issuedAt.toISOString(),
      issued_by: partner?.name ?? PLATFORM_NAME,
      customer_document: maskDocument(invoice.customer.documentNumber),
      subtotal: invoice.subtotal,
      tax_amount: invoice.taxAmount,
      total: invoice.total,
      items: invoice.items.map((item) => ({
        description: item.description,
        quantity: Number(item.quantity),
        line_total: item.lineTotal,
      })),
      payment: payment
        ? { method: payment.method, amount: payment.amount }
        : null,
    };
  }
}
