import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CustomersModule } from '../customers/customers.module';
import { InvoiceItem } from './entities/invoice-item.entity';
import { Invoice } from './entities/invoice.entity';
import { Payment } from './entities/payment.entity';
import { Receipt } from './entities/receipt.entity';
import { IdempotencyService } from './idempotency/idempotency.service';

@Module({
    imports: [
        TypeOrmModule.forFeature([Invoice, InvoiceItem, Payment, Receipt]),
        CustomersModule,
    ],
    providers: [IdempotencyService],
    exports: [IdempotencyService, TypeOrmModule],
})
export class BillingModule { }