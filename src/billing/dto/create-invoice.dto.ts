import { Type } from 'class-transformer';
import {ArrayMinSize,IsArray,IsIn,IsNumber,IsOptional,IsPositive,IsString,Matches,MaxLength,ValidateNested,} from 'class-validator';

const AMOUNT_REGEX = /^\d+(\.\d{1,2})?$/;

export class CustomerRefDto {
    @IsOptional()
    @IsIn(['CC', 'NIT', 'CE'])
    document_type?: 'CC' | 'NIT' | 'CE';

    @IsString()
    @Matches(/^\d{1,20}$/, { message: 'document_number debe tener solo dígitos (máximo 20)' })
    document_number: string;
}

export class InvoiceItemInputDto {
    @IsString()
    @MaxLength(200)
    description: string;

    @IsNumber({ maxDecimalPlaces: 2 })
    @IsPositive()
    quantity: number;

    @IsString()
    @Matches(AMOUNT_REGEX, { message: 'unit_price debe ser un decimal como texto, por ejemplo "80000.00"' })
    unit_price: string;
}

export class InvoicePaymentInputDto {
    @IsIn(['cash', 'card', 'transfer'])
    method: 'cash' | 'card' | 'transfer';

    @IsOptional()
    @IsString()
    @Matches(AMOUNT_REGEX, { message: 'amount debe ser un decimal como texto, por ejemplo "124950.00"' })
    amount?: string;
}

export class CreateInvoiceDto {
    @ValidateNested()
    @Type(() => CustomerRefDto)
    customer: CustomerRefDto;

    @IsArray()
    @ArrayMinSize(1)
    @ValidateNested({ each: true })
    @Type(() => InvoiceItemInputDto)
    items: InvoiceItemInputDto[];

    @IsOptional()
    @ValidateNested()
    @Type(() => InvoicePaymentInputDto)
    payment?: InvoicePaymentInputDto;

    @IsOptional()
    @IsString()
    @MaxLength(60)
    external_ref?: string;
}