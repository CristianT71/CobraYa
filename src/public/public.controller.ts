import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { RateLimitedError } from '../a2a/a2a.errors';
import { FailureLockout, SlidingWindowLimiter } from '../a2a/rate-limiter';
import { CONTRACT_VERSION } from '../app.setup';
import { ReceiptNotFoundError } from '../billing/domain/billing.errors';
import { Public } from '../common/decorators/public.decorator';
import {
  ApiStandardErrors,
  ErrorEnvelopeDto,
} from '../common/swagger/api-docs.decorators';
import { PARTNER_SKILLS, SKILL_DESCRIPTIONS } from '../partners/skills';
import { PublicReceiptsService } from './public-receipts.service';
import { VerifyReceiptDto } from './verify-receipt.dto';

const VERIFY_PER_MINUTE = 10;

/**
 * Endpoints públicos para la página web: no llevan key, pero tampoco exponen datos
 * sensibles ni permiten escribir. Cada uno tiene sus propios límites.
 */
@ApiTags('public')
@Controller('public')
export class PublicController {
  // Límite por minuto y bloqueo tras fallos repetidos, por IP: frenan la
  // adivinación de comprobantes y documentos.
  private readonly limiter = new SlidingWindowLimiter();
  private readonly lockout = new FailureLockout();

  constructor(
    private readonly config: ConfigService,
    private readonly receipts: PublicReceiptsService,
  ) {}

  @Public()
  @Get('info')
  @ApiOperation({
    summary:
      'Qué es y qué hace Facturación y Pagos (para la portada y para otros negocios)',
  })
  @ApiOkResponse({
    description: 'Descripción del servicio, alcance y habilidades',
  })
  info() {
    const base = this.config.getOrThrow<string>('a2a.publicBaseUrl');
    return {
      name: 'Facturación y Pagos',
      description:
        'Negocio de facturación para el ecosistema de taller vehicular: crea cuentas de cobro, registra pagos y emite comprobantes para otros negocios, ya sea con una frase en español o con datos estructurados.',
      version: CONTRACT_VERSION,
      a2a: {
        card_url: `${base}/.well-known/agent.json`,
        tasks_url: `${base}/a2a/tasks`,
        auth: 'Authorization: Bearer fac_… (o X-API-Key: fac_…)',
      },
      docs_url: `${base}/docs`,
      skills: PARTNER_SKILLS.map((id) => ({
        id,
        description: SKILL_DESCRIPTIONS[id],
      })),
      scope: {
        does: [
          'Cuentas de cobro con sus ítems, cálculo exacto de subtotal, impuesto y total',
          'Pagos únicos y completos',
          'Comprobantes con consecutivo interno',
        ],
        does_not: [
          'Facturación electrónica ni DIAN',
          'Contabilidad (libros, balances, reportes tributarios)',
          'Procesamiento de tarjetas ni movimiento de dinero: el pago se registra en el sistema',
        ],
      },
    };
  }

  @Public()
  @Post('receipts/verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Verifica un comprobante con su número y el documento del cliente',
    description:
      'Devuelve lo justo para comprobar que el comprobante es auténtico (negocio emisor, fecha, ítems y total). ' +
      'Un número inexistente y un documento equivocado responden exactamente igual. ' +
      `Límite: ${VERIFY_PER_MINUTE} consultas por minuto por IP, y bloqueo temporal tras 10 intentos fallidos.`,
  })
  @ApiStandardErrors()
  @ApiOkResponse({ description: 'Datos públicos del comprobante' })
  @ApiResponse({
    status: 404,
    description: 'No existe un comprobante con esos datos',
    type: ErrorEnvelopeDto,
  })
  @ApiResponse({
    status: 429,
    description: 'Demasiadas consultas o intentos fallidos (con Retry-After)',
    type: ErrorEnvelopeDto,
  })
  async verifyReceipt(
    @Body() dto: VerifyReceiptDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const ip = req.ip ?? 'desconocida';

    const blockedMs = this.lockout.remainingMs(ip);
    if (blockedMs > 0) {
      res.setHeader('Retry-After', String(Math.ceil(blockedMs / 1000)));
      throw new RateLimitedError(
        'Demasiados intentos fallidos; intenta de nuevo más tarde.',
      );
    }
    const hit = this.limiter.tryHit(ip, VERIFY_PER_MINUTE, 60_000);
    if (!hit.allowed) {
      res.setHeader('Retry-After', String(Math.ceil(hit.retryAfterMs / 1000)));
      throw new RateLimitedError();
    }

    try {
      return await this.receipts.verify(
        dto.receipt_number,
        dto.document_number,
      );
    } catch (error) {
      if (error instanceof ReceiptNotFoundError) this.lockout.recordFailure(ip);
      throw error;
    }
  }
}
