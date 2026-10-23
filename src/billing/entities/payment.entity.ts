import {Column,CreateDateColumn,Entity,JoinColumn,ManyToOne,PrimaryGeneratedColumn,} from 'typeorm';
import type { Relation } from 'typeorm';
import { Invoice } from './invoice.entity';

export type PaymentMethod = 'cash' | 'card' | 'transfer';

@Entity('payments')
export class Payment {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ name: 'invoice_id', type: 'uuid' })
    invoiceId: string;

    @ManyToOne(() => Invoice, (invoice) => invoice.payments, { nullable: false })
    @JoinColumn({ name: 'invoice_id' })
    invoice: Relation<Invoice>;

    @Column({ type: 'varchar', length: 10 })
    method: PaymentMethod;

    @Column({ type: 'numeric', precision: 14, scale: 2 })
    amount: string;

    @Column({ type: 'varchar', length: 10, default: 'APPLIED' })
    status: 'APPLIED';

    // Clave del POST que registró el pago (sección 7.6). Nula en el pago que nace
    // junto con la cuenta: ese se identifica por invoices.idempotency_key.
    @Column({
        name: 'idempotency_key',
        type: 'varchar',
        length: 100,
        nullable: true,
        unique: true,
    })
    idempotencyKey: string | null;

    @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
    createdAt: Date;
}