import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Req,
} from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { resolveRequestId } from '../common/interceptors/request-id.interceptor';
import {
  ApiIdempotencyKey,
  ApiStandardErrors,
  ErrorEnvelopeDto,
} from '../common/swagger/api-docs.decorators';
import { AgentOrchestrator } from './agent.orchestrator';
import { AgentRequestDto } from './dto/agent-request.dto';
import { AgentResponseDto } from './dto/agent-response.dto';

// Mismo largo que invoices.idempotency_key (varchar(100)).
const MAX_IDEMPOTENCY_KEY_LENGTH = 100;

@ApiTags('agent')
@Controller('agent')
export class AgentController {
  constructor(private readonly orchestrator: AgentOrchestrator) {}

  // Solo valida la entrada y delega (contrato, sección 4.1).
  @Post('requests')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Camino con IA: recibe texto libre, extrae, calcula, guarda y responde',
    description:
      'Lee `status` antes de usar `data`. completed, needs_clarification y rejected responden 200.',
  })
  @ApiIdempotencyKey()
  @ApiStandardErrors()
  @ApiOkResponse({ type: AgentResponseDto })
  @ApiResponse({
    status: 502,
    description: 'El modelo falló (LLM_UNAVAILABLE)',
    type: ErrorEnvelopeDto,
  })
  @ApiResponse({
    status: 504,
    description: 'El modelo no respondió a tiempo (LLM_UNAVAILABLE)',
    type: ErrorEnvelopeDto,
  })
  handle(
    @Body() dto: AgentRequestDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() req: Request,
  ): Promise<AgentResponseDto> {
    const key = idempotencyKey?.trim();
    // La solicitud puede crear o pagar, así que la clave siempre es obligatoria (sección 7.1).
    if (!key || key.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
      throw new BadRequestException({
        message: `Falta el encabezado Idempotency-Key o supera ${MAX_IDEMPOTENCY_KEY_LENGTH} caracteres.`,
        missing_fields: ['Idempotency-Key'],
      });
    }
    return this.orchestrator.handle({
      text: dto.text,
      requestId: resolveRequestId(req),
      idempotencyKey: key,
    });
  }
}
