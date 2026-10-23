import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  InvoiceNotFoundError,
  ReceiptNotFoundError,
} from '../domain/billing.errors';
import type { InvoiceResultData } from '../dto/invoice-result.dto';
import { Invoice } from '../entities/invoice.entity';
import { Receipt } from '../entities/receipt.entity';
import type {
  GetReceiptQuery,
  GetReceiptUseCasePort,
} from '../ports/billing-use-cases.port';
import { toResult } from './invoice-persistence';

// Consulta el comprobante de una cuenta pagada, por número de comprobante o por
// cuenta (RN-10: la consulta ya exige uno de los dos por su tipo). Solo lee.
@Injectable()
export class GetReceiptUseCase implements GetReceiptUseCasePort {
  constructor(private readonly dataSource: DataSource) {}

  async execute(query: GetReceiptQuery): Promise<InvoiceResultData> {
    const invoice =
      'receiptNumber' in query
        ? await this.findByReceiptNumber(query.receiptNumber, query.partnerId)
        : await this.findByInvoiceId(query.invoiceId, query.partnerId);
    return toResult(invoice);
  }

  private async findByReceiptNumber(
    receiptNumber: number,
    partnerId?: string,
  ): Promise<Invoice> {
    const receipt = await this.dataSource
      .getRepository(Receipt)
      .findOneBy({ receiptNumber });
    if (!receipt) throw new ReceiptNotFoundError();
    const invoice = await this.loadInvoice(receipt.invoiceId);
    // El comprobante de otro negocio es indistinguible de uno que no existe.
    if (partnerId !== undefined && invoice.partnerId !== partnerId) {
      throw new ReceiptNotFoundError();
    }
    return invoice;
  }

  private async findByInvoiceId(
    invoiceId: string,
    partnerId?: string,
  ): Promise<Invoice> {
    const invoice = await this.loadInvoice(invoiceId);
    if (partnerId !== undefined && invoice.partnerId !== partnerId) {
      throw new InvoiceNotFoundError();
    }
    // La cuenta existe pero aún no se pagó: no tiene comprobante (RN-09).
    if (!invoice.receipt) throw new ReceiptNotFoundError();
    return invoice;
  }

  private async loadInvoice(invoiceId: string): Promise<Invoice> {
    const invoice = await this.dataSource.getRepository(Invoice).findOne({
      where: { id: invoiceId },
      relations: { customer: true, items: true, payments: true, receipt: true },
    });
    if (!invoice) throw new InvoiceNotFoundError();
    return invoice;
  }
}
