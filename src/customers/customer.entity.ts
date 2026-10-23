import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

export type DocumentType = 'CC' | 'NIT' | 'CE';

@Entity('customers')
@Unique('uq_customers_document', ['documentType', 'documentNumber'])
export class Customer {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'document_type', type: 'varchar', length: 3 })
  documentType: DocumentType;

  @Column({ name: 'document_number', type: 'varchar', length: 20 })
  documentNumber: string;

  @Column({ name: 'full_name', type: 'varchar', length: 150 })
  fullName: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
