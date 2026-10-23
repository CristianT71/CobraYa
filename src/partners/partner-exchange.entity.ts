import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

// Bitácora de cada intercambio con un negocio: quién pidió qué, con qué
// resultado y cuánto tardó. Nunca guarda el cuerpo completo ni cédulas
// completas: `summary` es un resumen corto y enmascarado.
@Entity({ name: 'partner_exchanges' })
export class PartnerExchange {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'partner_id', type: 'uuid' })
  partnerId: string;

  @Column({ name: 'request_id', type: 'varchar', length: 64 })
  requestId: string;

  @Column({ type: 'varchar', length: 30 })
  skill: string;

  // completed | needs_clarification | rejected | error
  @Column({ type: 'varchar', length: 20 })
  status: string;

  @Column({ name: 'error_code', type: 'varchar', length: 40, nullable: true })
  errorCode: string | null;

  @Column({ name: 'http_status', type: 'smallint' })
  httpStatus: number;

  @Column({ name: 'latency_ms', type: 'integer' })
  latencyMs: number;

  @Column({ type: 'text', nullable: true })
  summary: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
