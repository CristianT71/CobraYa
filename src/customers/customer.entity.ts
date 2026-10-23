import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

export type DocumentType = 'CC' | 'NIT' | 'CE';

// Cada cliente es de un negocio (partner_id) o de la plataforma (NULL). La unicidad
// del documento es por negocio: índice uq_customers_scope_document (migración
// AddPartnersAndTenancy), no una restricción global.
@Entity('customers')
export class Customer {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'partner_id', type: 'uuid', nullable: true })
  partnerId: string | null;

  @Column({ name: 'document_type', type: 'varchar', length: 3 })
  documentType: DocumentType;

  @Column({ name: 'document_number', type: 'varchar', length: 20 })
  documentNumber: string;

  @Column({ name: 'full_name', type: 'varchar', length: 150 })
  fullName: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
