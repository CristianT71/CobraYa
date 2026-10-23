import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { InvoiceResultData } from '../dto/invoice-result.dto';
import { Invoice } from '../entities/invoice.entity';
import { InvoiceNotFoundError } from '../domain/billing.errors';
import { toInvoiceResultData } from '../mappers/invoice-result.mapper';

@Injectable()
export class InvoiceQueryService {
  constructor(
    @InjectRepository(Invoice)
    private readonly invoicesRepository: Repository<Invoice>,
  ) {}

  // `partnerId` restringe la consulta a las cuentas de un negocio; sin él no hay
  // restricción (operador).
  async getResultById(
    invoiceId: string,
    partnerId?: string,
  ): Promise<InvoiceResultData> {
    const invoice = await this.invoicesRepository.findOne({
      where: { id: invoiceId },
      relations: { customer: true, items: true, payments: true, receipt: true },
    });
    if (
      !invoice ||
      (partnerId !== undefined && invoice.partnerId !== partnerId)
    ) {
      throw new InvoiceNotFoundError();
    }
    return toInvoiceResultData(invoice);
  }
}
