import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';
import type { PartnerSkill } from './skills';

// Un negocio que usa el servicio (concesionario, taller, repuestos...).
// La key nunca se guarda: solo su hash (ver partner-keys.ts).
@Entity({ name: 'partners' })
export class Partner {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 20, unique: true })
  slug: string;

  @Column({ type: 'varchar', length: 80 })
  name: string;

  @Column({ name: 'key_hash', type: 'varchar', length: 64, unique: true })
  keyHash: string;

  @Column({ name: 'key_prefix', type: 'varchar', length: 12 })
  keyPrefix: string;

  @Column({ type: 'text', array: true })
  skills: PartnerSkill[];

  @Column({ type: 'boolean', default: true })
  active: boolean;

  @Column({ name: 'rate_per_minute', type: 'integer', default: 30 })
  ratePerMinute: number;

  @Column({ name: 'daily_quota', type: 'integer', default: 500 })
  dailyQuota: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Column({ name: 'last_used_at', type: 'timestamptz', nullable: true })
  lastUsedAt: Date | null;
}
