import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Invoice } from '../billing/entities/invoice.entity';
import { Receipt } from '../billing/entities/receipt.entity';
import { Partner } from '../partners/partner.entity';
import { PublicReceiptsService } from './public-receipts.service';
import { PublicController } from './public.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Receipt, Invoice, Partner])],
  controllers: [PublicController],
  providers: [PublicReceiptsService],
})
export class PublicModule {}
