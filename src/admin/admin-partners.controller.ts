import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ExchangeAuditService } from '../a2a/exchange-audit.service';
import { ApiStandardErrors } from '../common/swagger/api-docs.decorators';
import { PartnersService } from '../partners/partners.service';
import {
  CreatePartnerDto,
  ExchangesQueryDto,
  UpdatePartnerDto,
} from './admin-partners.dto';

const KEY_WARNING =
  'Guarda esta key ahora: no se vuelve a mostrar. Si se pierde, rótala.';

/**
 * Administración de los negocios que usan el servicio. Solo el operador: exige la
 * X-API-Key de servicio, como el resto de la API (la key de un negocio no sirve aquí).
 */
@ApiTags('admin')
@Controller('admin/partners')
@ApiStandardErrors()
export class AdminPartnersController {
  constructor(
    private readonly partners: PartnersService,
    private readonly exchanges: ExchangeAuditService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Lista los negocios registrados (sin sus keys)' })
  list() {
    return this.partners.list();
  }

  @Post()
  @ApiOperation({
    summary: 'Registra un negocio y devuelve su key, una sola vez',
    description:
      'La key (`fac_…`) es la que el negocio usa en `Authorization: Bearer` para llamar a /a2a/tasks. En la base solo se guarda su hash.',
  })
  async create(@Body() dto: CreatePartnerDto) {
    const { partner, apiKey } = await this.partners.create({
      slug: dto.slug,
      name: dto.name.trim(),
      skills: dto.skills,
      ratePerMinute: dto.rate_per_minute,
      dailyQuota: dto.daily_quota,
    });
    return { partner, api_key: apiKey, warning: KEY_WARNING };
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Cambia nombre, permisos, límites o desactiva a un negocio',
  })
  update(@Param('id') id: string, @Body() dto: UpdatePartnerDto) {
    return this.partners.update(id, {
      name: dto.name?.trim(),
      skills: dto.skills,
      active: dto.active,
      ratePerMinute: dto.rate_per_minute,
      dailyQuota: dto.daily_quota,
    });
  }

  @Post(':id/rotate-key')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Genera una key nueva; la anterior deja de servir de inmediato',
  })
  async rotateKey(@Param('id') id: string) {
    const { partner, apiKey } = await this.partners.rotateKey(id);
    return { partner, api_key: apiKey, warning: KEY_WARNING };
  }

  @Get(':id/exchanges')
  @ApiOperation({
    summary:
      'Últimos intercambios de un negocio (quién pidió qué y con qué resultado)',
  })
  async listExchanges(
    @Param('id') id: string,
    @Query() query: ExchangesQueryDto,
  ) {
    // Falla con 404 si el negocio no existe.
    await this.partners.get(id);
    return this.exchanges.listFor(id, query.limit);
  }
}
