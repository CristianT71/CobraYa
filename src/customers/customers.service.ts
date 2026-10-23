import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { Customer, DocumentType } from './customer.entity';

export interface CustomerSummary {
  id: string;
  document_type: DocumentType;
  document_number: string;
  full_name: string;
}

@Injectable()
export class CustomersService {
  constructor(
    @InjectRepository(Customer)
    private readonly customersRepository: Repository<Customer>,
  ) {}

  /**
   * Busca clientes por documento dentro de un ámbito; nunca crea clientes (RN-01).
   * Sin tipo, busca solo por número y puede devolver más de uno (RN-02).
   *
   * `partnerId` es el negocio dueño de los clientes; sin él (o null) es el ámbito de
   * la plataforma. Un negocio nunca ve los clientes de otro.
   */
  async findByDocument(
    documentType: DocumentType | null,
    documentNumber: string,
    partnerId?: string | null,
  ): Promise<CustomerSummary[]> {
    const customers = await this.customersRepository.find({
      where: {
        partnerId: partnerId ?? IsNull(),
        documentNumber,
        ...(documentType ? { documentType } : {}),
      },
    });
    return customers.map(toSummary);
  }

  /**
   * Registra un cliente de un negocio con datos que el negocio entrega de forma
   * estructurada (nunca con datos que extrajo el modelo). Solo crea: si el cliente
   * ya existe lo devuelve tal cual, sin editarlo (la edición queda fuera de alcance).
   */
  async register(input: {
    partnerId?: string | null;
    documentType: DocumentType;
    documentNumber: string;
    fullName: string;
  }): Promise<{ customer: CustomerSummary; created: boolean }> {
    const partnerId = input.partnerId ?? null;
    const [existing] = await this.findByDocument(
      input.documentType,
      input.documentNumber,
      partnerId,
    );
    if (existing) return { customer: existing, created: false };

    // ON CONFLICT DO NOTHING: si otra petición lo registró entre la búsqueda y
    // el insert, se devuelve el que ganó.
    const inserted = await this.customersRepository
      .createQueryBuilder()
      .insert()
      .into(Customer)
      .values({
        partnerId,
        documentType: input.documentType,
        documentNumber: input.documentNumber,
        fullName: input.fullName,
      })
      .orIgnore()
      .returning('id')
      .execute();
    const [stored] = await this.findByDocument(
      input.documentType,
      input.documentNumber,
      partnerId,
    );
    return {
      customer: stored,
      created: (inserted.raw as unknown[]).length > 0,
    };
  }
}

function toSummary(customer: Customer): CustomerSummary {
  return {
    id: customer.id,
    document_type: customer.documentType,
    document_number: customer.documentNumber,
    full_name: customer.fullName,
  };
}
