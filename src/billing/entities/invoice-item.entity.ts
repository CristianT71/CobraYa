import {Column,Entity,JoinColumn,ManyToOne,PrimaryGeneratedColumn,} from 'typeorm';
import type { Relation } from 'typeorm';
import { Invoice } from './invoice.entity';

@Entity('invoice_items')
export class InvoiceItem {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ name: 'invoice_id', type: 'uuid' })
    invoiceId: string;

    @ManyToOne(() => Invoice, (invoice) => invoice.items, {
        nullable: false,
        onDelete: 'CASCADE',
    })
    @JoinColumn({ name: 'invoice_id' })
    invoice: Relation<Invoice>;

    @Column({ type: 'varchar', length: 200 })
    description: string;

    @Column({ type: 'numeric', precision: 10, scale: 2 })
    quantity: string;

    @Column({ name: 'unit_price', type: 'numeric', precision: 14, scale: 2 })
    unitPrice: string;

    @Column({ name: 'line_total', type: 'numeric', precision: 14, scale: 2 })
    lineTotal: string;
}