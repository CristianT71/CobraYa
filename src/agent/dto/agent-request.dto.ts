import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

// Tope de `text` para acotar costo y superficie de ataque (contrato, sección 10.1).
export const MAX_TEXT_LENGTH = 2000;

// Solicitud del supervisor (contrato, sección 7.3).
export class AgentRequestDto {
  @ApiPropertyOptional({
    example: 'sup-20261021-0001',
    description:
      'Identificador de la solicitud; también puede llegar en X-Request-Id. Si falta, el servicio genera uno.',
    maxLength: 64,
  })
  @IsOptional()
  @IsString()
  @Matches(/^[\w.:-]{1,64}$/, {
    message: 'request_id solo admite letras, dígitos y . _ : - (hasta 64)',
  })
  request_id?: string;

  @ApiProperty({
    example:
      'Cóbrale a la cédula 1032456789 un cambio de aceite de 80.000 y un filtro de 25.000, pagó en efectivo',
    maxLength: MAX_TEXT_LENGTH,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_TEXT_LENGTH)
  text: string;

  @ApiPropertyOptional({
    type: Object,
    description:
      'Contexto opcional del supervisor; no se envía al modelo ni se guarda.',
  })
  @IsOptional()
  @IsObject()
  context?: Record<string, unknown>;
}
