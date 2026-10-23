import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiBearerAuth,
  ApiBody,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { CONTRACT_VERSION } from '../app.setup';
import { Public } from '../common/decorators/public.decorator';
import { resolveRequestId } from '../common/interceptors/request-id.interceptor';
import {
  ErrorEnvelopeDto,
  ApiStandardErrors,
} from '../common/swagger/api-docs.decorators';
import { PARTNER_SKILLS, SKILL_DESCRIPTIONS } from '../partners/skills';
import { PartnerAuthGuard, type PartnerRequest } from './partner-auth.guard';
import { TasksService } from './tasks.service';

/**
 * Tarjeta pública del bot: dice qué sabe hacer este negocio y cómo llamarlo. No
 * requiere key. La URL sale de la configuración (A2A_PUBLIC_BASE_URL), nunca de la
 * cabecera Host de quien la pide.
 */
@ApiTags('a2a')
@Controller('.well-known')
export class AgentCardController {
  constructor(private readonly config: ConfigService) {}

  @Public()
  @Get('agent.json')
  @ApiOperation({
    summary: 'Tarjeta pública del bot de Facturación y Pagos (formato A2A)',
  })
  @ApiOkResponse({ description: 'Nombre, URL de las tareas y habilidades' })
  card(@Res({ passthrough: true }) res: Response): object {
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const base = this.config.getOrThrow<string>('a2a.publicBaseUrl');
    return {
      name: 'Facturación y Pagos',
      description:
        'Negocio de facturación: crea cuentas de cobro, registra pagos y emite comprobantes para otros negocios. No es facturación electrónica ni contabilidad.',
      url: `${base}/a2a`,
      version: CONTRACT_VERSION,
      skills: [...PARTNER_SKILLS],
      skill_details: PARTNER_SKILLS.map((id) => ({
        id,
        description: SKILL_DESCRIPTIONS[id],
      })),
      authentication: {
        schemes: ['bearer', 'x-api-key'],
        note: 'Authorization: Bearer fac_… o X-API-Key: fac_… (la key la entrega el administrador de Facturación y Pagos al registrar tu negocio)',
      },
      documentation: `${base}/docs`,
    };
  }
}

/**
 * Tareas entrantes de otros negocios. La key identifica al negocio; todo lo que
 * hace una tarea queda dentro de ese negocio.
 */
@ApiTags('a2a')
@Controller('a2a')
export class A2aTasksController {
  constructor(private readonly tasks: TasksService) {}

  @Public()
  @UseGuards(PartnerAuthGuard)
  @Post('tasks')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('partner-key')
  @ApiOperation({
    summary:
      'Recibe una tarea de un negocio (key del negocio en Authorization: Bearer)',
    description:
      'Dos formas de pedir: en lenguaje natural, `{ "from": "mi-bot", "message": "Cóbrale a la cédula 1032456789 un filtro de 25.000, pagó en efectivo" }`; ' +
      'o con una habilidad explícita, `{ "skill": "crear_cuenta", "params": { … } }`. ' +
      'Habilidades: registrar_cliente, crear_cuenta, registrar_pago, consultar_cuenta, consultar_comprobante y lenguaje_natural. ' +
      'Crear y pagar exigen `Idempotency-Key` (encabezado o campo `idempotency_key`). ' +
      'Los resultados de negocio (completed, needs_clarification, rejected) responden 200; el campo `answer` trae un texto listo para mostrar.',
  })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: false,
    description:
      'Obligatoria para crear cuentas y registrar pagos; una repetición devuelve el resultado original.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        from: { type: 'string', example: 'automax-bot' },
        message: {
          type: 'string',
          example:
            'Cóbrale a la cédula 1032456789 un cambio de aceite de 80.000, pagó en efectivo',
        },
        skill: { type: 'string', enum: [...PARTNER_SKILLS] },
        params: { type: 'object' },
        idempotency_key: { type: 'string' },
      },
    },
  })
  @ApiStandardErrors()
  @ApiOkResponse({ description: 'Resultado de la tarea (envoltorio + answer)' })
  @ApiResponse({
    status: 403,
    description: 'El negocio no tiene permiso para esa habilidad',
    type: ErrorEnvelopeDto,
  })
  @ApiResponse({
    status: 429,
    description:
      'Límite por minuto, cuota diaria o demasiados intentos con key inválida (con Retry-After)',
    type: ErrorEnvelopeDto,
  })
  handle(
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() req: PartnerRequest,
  ) {
    return this.tasks.handle(req.partner!, body, {
      requestId: resolveRequestId(req),
      idempotencyKey,
    });
  }
}
