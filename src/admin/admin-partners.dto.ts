import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { PARTNER_SKILLS, type PartnerSkill } from '../partners/skills';

// Mismo formato que la restricción ck_partners_slug de la base de datos.
const SLUG = /^[a-z][a-z0-9-]{1,19}$/;

export class CreatePartnerDto {
  @ApiProperty({
    example: 'concesionario',
    description:
      'Identificador del negocio: minúsculas, dígitos y guiones, de 2 a 20 caracteres. No se puede cambiar.',
  })
  @IsString()
  @Matches(SLUG, {
    message:
      'slug: minúsculas, dígitos y guiones; empieza con una letra; de 2 a 20 caracteres',
  })
  slug: string;

  @ApiProperty({ example: 'AutoMax Concesionario' })
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name: string;

  @ApiPropertyOptional({
    enum: PARTNER_SKILLS,
    isArray: true,
    description: 'Habilidades permitidas; por defecto, todas.',
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(PARTNER_SKILLS.length)
  @IsIn(PARTNER_SKILLS, { each: true })
  skills?: PartnerSkill[];

  @ApiPropertyOptional({ example: 30, minimum: 1, maximum: 600 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(600)
  rate_per_minute?: number;

  @ApiPropertyOptional({ example: 500, minimum: 1, maximum: 100000 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100_000)
  daily_quota?: number;
}

export class UpdatePartnerDto {
  @ApiPropertyOptional({ example: 'AutoMax Concesionario S.A.S.' })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name?: string;

  @ApiPropertyOptional({ enum: PARTNER_SKILLS, isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(PARTNER_SKILLS.length)
  @IsIn(PARTNER_SKILLS, { each: true })
  skills?: PartnerSkill[];

  @ApiPropertyOptional({
    description:
      'false desactiva al negocio: su key deja de servir de inmediato.',
  })
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({ minimum: 1, maximum: 600 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(600)
  rate_per_minute?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 100000 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100_000)
  daily_quota?: number;
}

export class ExchangesQueryDto {
  @ApiPropertyOptional({ default: 50, minimum: 1, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}
