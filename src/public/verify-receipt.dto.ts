import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsString, Matches, Max, Min } from 'class-validator';

export class VerifyReceiptDto {
  @ApiProperty({ example: 1, description: 'Número del comprobante.' })
  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  receipt_number: number;

  @ApiProperty({
    example: '1032456789',
    description:
      'Documento del cliente al que se emitió el comprobante. Se acepta con puntos o espacios.',
  })
  @IsString()
  @Matches(/^[\d.\s-]{5,30}$/, {
    message:
      'document_number debe tener solo dígitos (se aceptan puntos y espacios)',
  })
  document_number: string;
}
