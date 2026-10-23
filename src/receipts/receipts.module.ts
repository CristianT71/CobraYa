import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Invoice } from '../billing/entities/invoice.entity';
import { Receipt } from '../billing/entities/receipt.entity';
import { Partner } from '../partners/partner.entity';
import { ReceiptDocumentService } from './receipt-document.service';
import { ReceiptLinkService } from './receipt-link.service';
import { ReceiptPdfService } from './receipt-pdf.service';

@Module({
  imports: [TypeOrmModule.forFeature([Receipt, Invoice, Partner])],
  providers: [ReceiptDocumentService, ReceiptPdfService, ReceiptLinkService],
  exports: [ReceiptDocumentService, ReceiptPdfService, ReceiptLinkService],
})
export class ReceiptsModule {}
