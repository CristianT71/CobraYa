import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Matches } from 'class-validator';

export class RegisterPaymentDto {
  @ApiProperty({ enum: ['cash', 'card', 'transfer'], example: 'transfer' })
  @IsIn(['cash', 'card', 'transfer'])
  method: 'cash' | 'card' | 'transfer';

  // Si no viene, el caso de uso usa el total de la cuenta (RN-06)
  @ApiPropertyOptional({
    example: '124950.00',
    description:
      'Decimal como texto. Si se omite, se usa el total de la cuenta (RN-06).',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d+(\.\d{1,2})?$/, {
    message: 'amount debe ser un decimal como texto, por ejemplo "124950.00"',
  })
  amount?: string;
}
