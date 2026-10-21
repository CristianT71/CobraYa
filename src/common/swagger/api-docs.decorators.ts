import { applyDecorators } from '@nestjs/common';
import {
  ApiHeader,
  ApiProperty,
  ApiPropertyOptional,
  ApiResponse,
} from '@nestjs/swagger';
import { ERROR_CATALOG } from '../errors/error-catalog';

export class ErrorDataDto {
  @ApiProperty({
    enum: Object.keys(ERROR_CATALOG),
    example: 'CUSTOMER_NOT_FOUND',
  })
  error_code: string;
}

/** Envoltorio de error de las secciones 7.4 y 9, para documentar respuestas en Swagger. */
export class ErrorEnvelopeDto {
  @ApiProperty({
    enum: ['needs_clarification', 'rejected', 'error'],
    example: 'rejected',
  })
  status: string;

  @ApiProperty({ example: 'El cliente no existe.' })
  message: string;

  @ApiPropertyOptional({ type: ErrorDataDto, nullable: true })
  data: ErrorDataDto | null;

  @ApiProperty({ type: [String], example: [] })
  missing_fields: string[];

  @ApiProperty({ example: 'sup-20261021-0001' })
  request_id: string;
}

/** Encabezado Idempotency-Key obligatorio (secciones 7.1 y 7.6). Para los POST que crean o pagan. */
export const ApiIdempotencyKey = () =>
  ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description:
      'Cadena única por operación; una repetición devuelve el resultado original.',
  });

/** Respuestas de error comunes a todas las rutas protegidas (sección 7.5). */
export const ApiStandardErrors = () =>
  applyDecorators(
    ApiHeader({
      name: 'X-Request-Id',
      required: false,
      description: 'Si falta, el servicio genera uno y lo devuelve.',
    }),
    ApiResponse({
      status: 400,
      description: 'Cuerpo inválido',
      type: ErrorEnvelopeDto,
    }),
    ApiResponse({
      status: 401,
      description: 'Falta o es inválida la X-API-Key',
      type: ErrorEnvelopeDto,
    }),
    ApiResponse({
      status: 500,
      description: 'Error inesperado',
      type: ErrorEnvelopeDto,
    }),
  );
