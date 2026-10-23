import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CustomersModule } from '../customers/customers.module';
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
    pendingUseCase,
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
        // Provisionales hasta que Jheison suba los casos de uso. Cuando existan:
        // registrar CreateInvoiceUseCase, etc. como providers y cambiar cada línea por
        // { provide: CREATE_INVOICE_USE_CASE, useExisting: CreateInvoiceUseCase }
        { provide: CREATE_INVOICE_USE_CASE, useValue: pendingUseCase('CreateInvoice') },
        { provide: REGISTER_PAYMENT_USE_CASE, useValue: pendingUseCase('RegisterPayment') },
        { provide: GET_RECEIPT_USE_CASE, useValue: pendingUseCase('GetReceipt') },
    ],
    exports: [IdempotencyService, TypeOrmModule],
})
export class BillingModule { }