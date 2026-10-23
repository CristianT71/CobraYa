import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import { Invoice } from '../../billing/entities/invoice.entity';
import {
  CREATE_INVOICE_USE_CASE,
  GET_RECEIPT_USE_CASE,
  REGISTER_PAYMENT_USE_CASE,
  type CreateInvoiceUseCasePort,
  type GetReceiptUseCasePort,
  type RegisterPaymentUseCasePort,
} from '../../billing/ports/billing-use-cases.port';
import type {
  BillingGateway,
  CreateInvoiceCommand,
  GetReceiptQuery,
  RegisterPaymentCommand,
} from './billing-gateway.port';

// Adaptador del puerto que el orquestador necesita (BillingGateway) hacia los
// casos de uso de billing. agent puede usar billing; nunca al revés.
@Injectable()
export class BillingUseCasesGateway implements BillingGateway {
  constructor(
    @Inject(CREATE_INVOICE_USE_CASE)
    private readonly createInvoiceUseCase: CreateInvoiceUseCasePort,
    @Inject(REGISTER_PAYMENT_USE_CASE)
    private readonly registerPaymentUseCase: RegisterPaymentUseCasePort,
    @Inject(GET_RECEIPT_USE_CASE)
    private readonly getReceiptUseCase: GetReceiptUseCasePort,
    @InjectRepository(Invoice)
    private readonly invoices: Repository<Invoice>,
  ) {}

  createInvoice(command: CreateInvoiceCommand) {
    return this.createInvoiceUseCase.execute(command);
  }

  registerPayment(command: RegisterPaymentCommand) {
    return this.registerPaymentUseCase.execute(command);
  }

  getReceipt(query: GetReceiptQuery) {
    return this.getReceiptUseCase.execute(query);
  }

  // RN-08: para pagar sin indicar la cuenta, el cliente debe tener exactamente
  // una cuenta PENDING. Es solo una consulta; no hay caso de uso para ella.
  async findPendingInvoiceIds(
    customerId: string,
    partnerId?: string,
  ): Promise<string[]> {
    const pending = await this.invoices.find({
      select: { id: true },
      where: {
        customerId,
        status: 'PENDING',
        ...(partnerId !== undefined ? { partnerId } : {}),
      },
    });
    return pending.map((invoice) => invoice.id);
  }
}
