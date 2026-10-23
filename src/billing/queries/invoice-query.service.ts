import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { InvoiceResultData } from '../dto/invoice-result.dto';
import { Invoice } from '../entities/invoice.entity';
import { InvoiceNotFoundError } from '../errors/direct-path.errors';
import { toInvoiceResultData } from '../mappers/invoice-result.mapper';

@Injectable()
export class InvoiceQueryService {
    constructor(
        @InjectRepository(Invoice)
        private readonly invoicesRepository: Repository<Invoice>,
    ) { }

    async getResultById(invoiceId: string): Promise<InvoiceResultData> {
        const invoice = await this.invoicesRepository.findOne({
            where: { id: invoiceId },
            relations: { customer: true, items: true, payments: true, receipt: true },
        });
        if (!invoice) {
            throw new InvoiceNotFoundError();
        }
        return toInvoiceResultData(invoice);
    }
}