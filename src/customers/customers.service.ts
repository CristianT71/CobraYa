import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
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
    ) { }

    /**
     * Busca clientes por documento; nunca crea clientes (RN-01).
     * Sin tipo, busca solo por número y puede devolver más de uno (RN-02).
     */
    async findByDocument(
        documentType: DocumentType | null,
        documentNumber: string,
    ): Promise<CustomerSummary[]> {
        const customers = await this.customersRepository.find({
            where: documentType
                ? { documentType, documentNumber }
                : { documentNumber },
        });
        return customers.map((customer) => ({
            id: customer.id,
            document_type: customer.documentType,
            document_number: customer.documentNumber,
            full_name: customer.fullName,
        }));
    }
}
