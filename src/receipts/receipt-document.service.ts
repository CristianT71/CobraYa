import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import { ReceiptNotFoundError } from '../billing/domain/billing.errors';
import { Invoice } from '../billing/entities/invoice.entity';
import { Receipt } from '../billing/entities/receipt.entity';
import { Partner } from '../partners/partner.entity';
import type { ReceiptDocument } from './receipt-document';

const PLATFORM_NAME = 'Facturación y Pagos';
const NOT_FOUND = 'No encontramos un comprobante con esos datos.';

// Carga un comprobante completo para imprimirlo. Hay dos formas de tener derecho a
// verlo: ser el negocio que lo emitió, o presentar el documento del cliente. En
// ambos casos, un comprobante inexistente y uno ajeno responden exactamente igual.
@Injectable()
export class ReceiptDocumentService {
  constructor(
    @InjectRepository(Receipt) private readonly receipts: Repository<Receipt>,
    @InjectRepository(Invoice) private readonly invoices: Repository<Invoice>,
    @InjectRepository(Partner) private readonly partners: Repository<Partner>,
  ) {}

  /** Para el negocio emisor (autenticado con su key). */
  forPartner(
    receiptNumber: number,
    partnerId: string,
  ): Promise<ReceiptDocument> {
    return this.load(
      receiptNumber,
      (invoice) => invoice.partnerId === partnerId,
    );
  }

  /** Para quien presenta el documento del cliente (verificación pública). */
  forCustomer(
    receiptNumber: number,
    documentNumber: string,
  ): Promise<ReceiptDocument> {
    const digits = documentNumber.replace(/\D/g, '');
    return this.load(
      receiptNumber,
      (invoice) => invoice.customer.documentNumber === digits,
    );
  }

  private async load(
    receiptNumber: number,
    allowed: (invoice: Invoice) => boolean,
  ): Promise<ReceiptDocument> {
    const receipt = await this.receipts.findOneBy({ receiptNumber });
    const invoice = receipt
      ? await this.invoices.findOne({
          where: { id: receipt.invoiceId },
          relations: { customer: true, items: true, payments: true },
        })
      : null;
    if (!receipt || !invoice || !allowed(invoice)) {
      throw new ReceiptNotFoundError(NOT_FOUND);
    }

    const partner = invoice.partnerId
      ? await this.partners.findOneBy({ id: invoice.partnerId })
      : null;
    const payment = invoice.payments[0] ?? null;

    return {
      receiptNumber: receipt.receiptNumber,
      issuedAt: receipt.issuedAt,
      issuerName: partner?.name ?? PLATFORM_NAME,
      customer: {
        fullName: invoice.customer.fullName,
        documentType: invoice.customer.documentType,
        documentNumber: invoice.customer.documentNumber,
      },
      items: invoice.items.map((item) => ({
        description: item.description,
        quantity: Number(item.quantity),
        unitPrice: item.unitPrice,
        lineTotal: item.lineTotal,
      })),
      subtotal: invoice.subtotal,
      taxRate: invoice.taxRate,
      taxAmount: invoice.taxAmount,
      total: invoice.total,
      payment: payment
        ? { method: payment.method, amount: payment.amount }
        : null,
    };
  }
}
