import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CustomersModule } from '../customers/customers.module';
import { CreateInvoiceUseCase } from './application/create-invoice.use-case';
import { GetReceiptUseCase } from './application/get-receipt.use-case';
import { RegisterPaymentUseCase } from './application/register-payment.use-case';
import { BillingController } from './billing.controller';
import { InvoiceItem } from './entities/invoice-item.entity';
import { Invoice } from './entities/invoice.entity';
import { Payment } from './entities/payment.entity';
import { Receipt } from './entities/receipt.entity';
import { IdempotencyService } from './idempotency/idempotency.service';
import {
    CREATE_INVOICE_USE_CASE,
    GET_RECEIPT_USE_CASE,
    REGISTER_PAYMENT_USE_CASE,
} from './ports/billing-use-cases.port';
import { InvoiceQueryService } from './queries/invoice-query.service';

@Module({
    imports: [
        TypeOrmModule.forFeature([Invoice, InvoiceItem, Payment, Receipt]),
        CustomersModule,
    ],
    controllers: [BillingController],
    providers: [
        IdempotencyService,
        InvoiceQueryService,
        CreateInvoiceUseCase,
        RegisterPaymentUseCase,
        GetReceiptUseCase,
        { provide: CREATE_INVOICE_USE_CASE, useExisting: CreateInvoiceUseCase },
        { provide: REGISTER_PAYMENT_USE_CASE, useExisting: RegisterPaymentUseCase },
        { provide: GET_RECEIPT_USE_CASE, useExisting: GetReceiptUseCase },
    ],
    // Los tokens de los casos de uso también los usa el módulo agent.
    exports: [
        IdempotencyService,
        TypeOrmModule,
        CREATE_INVOICE_USE_CASE,
        REGISTER_PAYMENT_USE_CASE,
        GET_RECEIPT_USE_CASE,
    ],
})
export class BillingModule { }