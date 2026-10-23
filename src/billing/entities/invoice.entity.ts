import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { Relation } from 'typeorm';
import { Customer } from '../../customers/customer.entity';
import { InvoiceItem } from './invoice-item.entity';
import { Payment } from './payment.entity';
import { Receipt } from './receipt.entity';

export type InvoiceStatusValue = 'PENDING' | 'PAID' | 'CANCELLED';
export type InvoiceSource = 'agent' | 'direct';

@Entity('invoices')
export class Invoice {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // Negocio dueño de la cuenta; NULL es la plataforma. Cada negocio solo ve las suyas.
  @Column({ name: 'partner_id', type: 'uuid', nullable: true })
  partnerId: string | null;

  @Column({ name: 'customer_id', type: 'uuid' })
  customerId: string;

  @ManyToOne(() => Customer, { nullable: false })
  @JoinColumn({ name: 'customer_id' })
  customer: Relation<Customer>;

  @Column({ type: 'varchar', length: 10, default: 'PENDING' })
  status: InvoiceStatusValue;

  // numeric llega como string desde pg: se mantiene así para usar decimal.js
  @Column({ type: 'numeric', precision: 14, scale: 2 })
  subtotal: string;

  @Column({ name: 'tax_rate', type: 'numeric', precision: 5, scale: 4 })
  taxRate: string;

  @Column({ name: 'tax_amount', type: 'numeric', precision: 14, scale: 2 })
  taxAmount: string;

  @Column({ type: 'numeric', precision: 14, scale: 2 })
  total: string;

  @Column({
    name: 'idempotency_key',
    type: 'varchar',
    length: 100,
    unique: true,
  })
  idempotencyKey: string;

  @Column({ type: 'varchar', length: 10 })
  source: InvoiceSource;

  @Column({ name: 'external_ref', type: 'varchar', length: 60, nullable: true })
  externalRef: string | null;

  @OneToMany(() => InvoiceItem, (item) => item.invoice, { cascade: ['insert'] })
  items: Relation<InvoiceItem[]>;

  @OneToMany(() => Payment, (payment) => payment.invoice, {
    cascade: ['insert'],
  })
  payments: Relation<Payment[]>;

  @OneToOne(() => Receipt, (receipt) => receipt.invoice)
  receipt: Relation<Receipt> | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
