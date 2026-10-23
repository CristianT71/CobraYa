import { ApiProperty } from '@nestjs/swagger';
import type { DocumentType } from '../../customers/customer.entity';
import type { PaymentMethod } from '../entities/payment.entity';

// Forma de `data` en una respuesta completed de create_invoice o
// register_payment. Todo monto es texto decimal y la cédula va enmascarada.
export interface InvoiceResultData {
  invoice_id: string;
  customer: {
    document_type: DocumentType;
    document_number: string;
    full_name: string;
  };
  items: Array<{
    description: string;
    quantity: number;
    unit_price: string;
    line_total: string;
  }>;
  subtotal: string;
  tax_rate: string;
  tax_amount: string;
  total: string;
  payment: {
    method: PaymentMethod;
    amount: string;
    status: 'APPLIED';
  } | null;
  receipt: { receipt_number: number; issued_at: string } | null;
}

export class ResultCustomerDto {
    @ApiProperty({ enum: ['CC', 'NIT', 'CE'], example: 'CC' })
    document_type: 'CC' | 'NIT' | 'CE';

    @ApiProperty({ example: '****6789', description: 'Cédula enmascarada.' })
    document_number: string;

    @ApiProperty({ example: 'Cliente de ejemplo' })
    full_name: string;
}

export class ResultItemDto {
    @ApiProperty({ example: 'Cambio de aceite' })
    description: string;

    @ApiProperty({ example: 1 })
    quantity: number;

    @ApiProperty({ example: '80000.00' })
    unit_price: string;

    @ApiProperty({ example: '80000.00' })
    line_total: string;
}

export class ResultPaymentDto {
    @ApiProperty({ enum: ['cash', 'card', 'transfer'], example: 'cash' })
    method: 'cash' | 'card' | 'transfer';

    @ApiProperty({ example: '124950.00' })
    amount: string;

    @ApiProperty({ enum: ['APPLIED'], example: 'APPLIED' })
    status: 'APPLIED';
}

export class ResultReceiptDto {
    @ApiProperty({ example: 1 })
    receipt_number: number;

    @ApiProperty({ example: '2026-10-21T21:50:00.000Z' })
    issued_at: string;
}

export class InvoiceResultResponseDto {
    @ApiProperty({ example: 'b2f1c0de-0000-4000-8000-000000000001' })
    invoice_id: string;

    @ApiProperty({ type: () => ResultCustomerDto })
    customer: ResultCustomerDto;

    @ApiProperty({ type: () => [ResultItemDto] })
    items: ResultItemDto[];

    @ApiProperty({ example: '105000.00' })
    subtotal: string;

    @ApiProperty({ example: '0.1900' })
    tax_rate: string;

    @ApiProperty({ example: '19950.00' })
    tax_amount: string;

    @ApiProperty({ example: '124950.00' })
    total: string;

    @ApiProperty({ type: () => ResultPaymentDto, nullable: true })
    payment: ResultPaymentDto | null;

    @ApiProperty({ type: () => ResultReceiptDto, nullable: true })
    receipt: ResultReceiptDto | null;
}
