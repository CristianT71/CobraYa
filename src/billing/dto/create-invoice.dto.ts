import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
    ArrayMinSize,
    IsArray,
    IsIn,
    IsNumber,
    IsOptional,
    IsPositive,
    IsString,
    Matches,
    MaxLength,
    ValidateNested,
} from 'class-validator';

const AMOUNT_REGEX = /^\d+(\.\d{1,2})?$/;

export class CustomerRefDto {
    @ApiPropertyOptional({
        enum: ['CC', 'NIT', 'CE'],
        example: 'CC',
        description: 'Tipo de documento. Si se omite, se busca solo por número (RN-02).',
    })
    @IsOptional()
    @IsIn(['CC', 'NIT', 'CE'])
    document_type?: 'CC' | 'NIT' | 'CE';

    @ApiProperty({ example: '1032456789', description: 'Solo dígitos, máximo 20.' })
    @IsString()
    @Matches(/^\d{1,20}$/, { message: 'document_number debe tener solo dígitos (máximo 20)' })
    document_number: string;
}

export class InvoiceItemInputDto {
    @ApiProperty({ example: 'Cambio de aceite', maxLength: 200 })
    @IsString()
    @MaxLength(200)
    description: string;

    @ApiProperty({ example: 1, description: 'Mayor que 0, hasta 2 decimales.' })
    @IsNumber({ maxDecimalPlaces: 2 })
    @IsPositive()
    quantity: number;

    @ApiProperty({
        example: '80000.00',
        description: 'Decimal como texto, con punto y sin separador de miles.',
    })
    @IsString()
    @Matches(AMOUNT_REGEX, { message: 'unit_price debe ser un decimal como texto, por ejemplo "80000.00"' })
    unit_price: string;
}

export class InvoicePaymentInputDto {
    @ApiProperty({ enum: ['cash', 'card', 'transfer'], example: 'cash' })
    @IsIn(['cash', 'card', 'transfer'])
    method: 'cash' | 'card' | 'transfer';

    @ApiPropertyOptional({
        example: '124950.00',
        description: 'Si se omite, el código usa el total de la cuenta (RN-06).',
    })
    @IsOptional()
    @IsString()
    @Matches(AMOUNT_REGEX, { message: 'amount debe ser un decimal como texto, por ejemplo "124950.00"' })
    amount?: string;
}

export class CreateInvoiceDto {
    @ApiProperty({ type: () => CustomerRefDto })
    @ValidateNested()
    @Type(() => CustomerRefDto)
    customer: CustomerRefDto;

    @ApiProperty({ type: () => [InvoiceItemInputDto], minItems: 1 })
    @IsArray()
    @ArrayMinSize(1)
    @ValidateNested({ each: true })
    @Type(() => InvoiceItemInputDto)
    items: InvoiceItemInputDto[];

    @ApiPropertyOptional({
        type: () => InvoicePaymentInputDto,
        description: 'Si viene, la cuenta se crea y se paga en la misma transacción (RN-05).',
    })
    @IsOptional()
    @ValidateNested()
    @Type(() => InvoicePaymentInputDto)
    payment?: InvoicePaymentInputDto;

    @ApiPropertyOptional({
        example: 'OT-2026-0042',
        maxLength: 60,
        description: 'Referencia opcional a una orden de otro grupo; solo informativa.',
    })
    @IsOptional()
    @IsString()
    @MaxLength(60)
    external_ref?: string;
}