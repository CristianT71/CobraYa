import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import { maskDocumentsInText } from '../common/utils/mask-document.util';
import { PartnerExchange } from '../partners/partner-exchange.entity';

export interface ExchangeRecord {
  partnerId: string;
  requestId: string;
  skill: string;
  status: string;
  errorCode: string | null;
  httpStatus: number;
  latencyMs: number;
  // Resumen corto de lo pedido; se enmascara y se recorta antes de guardarse.
  summary: string | null;
}

export interface ExchangeView {
  id: string;
  request_id: string;
  skill: string;
  status: string;
  error_code: string | null;
  http_status: number;
  latency_ms: number;
  summary: string | null;
  created_at: string;
}

const MAX_SUMMARY_CHARS = 300;

// Bitácora de cada intercambio con un negocio (partner_exchanges). Un fallo al
// escribirla nunca debe tumbar la respuesta al negocio.
@Injectable()
export class ExchangeAuditService {
  private readonly logger = new Logger(ExchangeAuditService.name);

  constructor(
    @InjectRepository(PartnerExchange)
    private readonly exchanges: Repository<PartnerExchange>,
  ) {}

  async record(entry: ExchangeRecord): Promise<void> {
    try {
      await this.exchanges.insert({
        partnerId: entry.partnerId,
        requestId: entry.requestId.slice(0, 64),
        skill: entry.skill.slice(0, 30),
        status: entry.status.slice(0, 20),
        errorCode: entry.errorCode?.slice(0, 40) ?? null,
        httpStatus: entry.httpStatus,
        latencyMs: Math.max(0, Math.round(entry.latencyMs)),
        summary: entry.summary
          ? maskDocumentsInText(entry.summary).slice(0, MAX_SUMMARY_CHARS)
          : null,
      });
    } catch (error) {
      this.logger.warn(
        `No se pudo registrar el intercambio (request_id=${entry.requestId}): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  // Intercambios atendidos hoy (hora de Bogotá): base de la cuota diaria.
  async countToday(partnerId: string): Promise<number> {
    const rows: Array<{ n: string }> = await this.exchanges.query(
      `SELECT count(*) AS n FROM partner_exchanges
       WHERE partner_id = $1
         AND created_at >= (date_trunc('day', now() AT TIME ZONE 'America/Bogota') AT TIME ZONE 'America/Bogota')`,
      [partnerId],
    );
    return Number(rows[0]?.n ?? 0);
  }

  async listFor(partnerId: string, limit = 50): Promise<ExchangeView[]> {
    const rows = await this.exchanges.find({
      where: { partnerId },
      order: { createdAt: 'DESC' },
      take: Math.min(Math.max(limit, 1), 200),
    });
    return rows.map((row) => ({
      id: row.id,
      request_id: row.requestId,
      skill: row.skill,
      status: row.status,
      error_code: row.errorCode,
      http_status: row.httpStatus,
      latency_ms: row.latencyMs,
      summary: row.summary,
      created_at: row.createdAt.toISOString(),
    }));
  }
}
