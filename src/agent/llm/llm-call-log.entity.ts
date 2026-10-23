import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

// Bitácora de llamadas al modelo (contrato, sección 5.6). La tabla la crea la
// migración inicial; cualquier cambio de columna va en una migración nueva.
// Se enlaza con la solicitud por request_id, sin llave foránea.
@Entity({ name: 'llm_call_logs' })
export class LlmCallLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'request_id', type: 'varchar', length: 64, nullable: true })
  requestId: string | null;

  @Column({ name: 'prompt_version', type: 'varchar', length: 20 })
  promptVersion: string;

  @Column({ type: 'varchar', length: 80 })
  model: string;

  // Con cédulas enmascaradas.
  @Column({ name: 'input_text', type: 'text' })
  inputText: string;

  // Con cédulas enmascaradas.
  @Column({ name: 'raw_output', type: 'text', nullable: true })
  rawOutput: string | null;

  @Column({ name: 'parsed_ok', type: 'boolean' })
  parsedOk: boolean;

  @Column({ type: 'smallint' })
  attempts: number;

  @Column({ name: 'prompt_tokens', type: 'integer', nullable: true })
  promptTokens: number | null;

  @Column({ name: 'completion_tokens', type: 'integer', nullable: true })
  completionTokens: number | null;

  @Column({ name: 'latency_ms', type: 'integer' })
  latencyMs: number;

  @Column({ type: 'text', nullable: true })
  error: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
