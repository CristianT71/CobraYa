import {
  Column,
  Entity,
  Generated,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import type { Relation } from 'typeorm';
import { Invoice } from './invoice.entity';

@Entity('receipts')
export class Receipt {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'invoice_id', type: 'uuid', unique: true })
  invoiceId: string;

  @OneToOne(() => Invoice, (invoice) => invoice.receipt, { nullable: false })
  @JoinColumn({ name: 'invoice_id' })
  invoice: Relation<Invoice>;

  // Lo asigna la base de datos desde receipt_number_seq (DEFAULT nextval)
  @Column({ name: 'receipt_number', type: 'int', unique: true })
  @Generated('increment')
  receiptNumber: number;

  @Column({ type: 'jsonb' })
  payload: Record<string, unknown>;

  @Column({ name: 'issued_at', type: 'timestamptz', default: () => 'now()' })
  issuedAt: Date;
}
