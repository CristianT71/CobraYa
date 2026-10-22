import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Customer, DocumentType } from './customer.entity';

@Injectable()
export class CustomersService {
    constructor(
        @InjectRepository(Customer)
        private readonly customersRepository: Repository<Customer>,
    ) { }

    // Búsqueda exacta (tipo + número). Nunca crea clientes.
    findByDocument(
        documentType: DocumentType,
        documentNumber: string,
    ): Promise<Customer | null> {
        return this.customersRepository.findOne({
            where: { documentType, documentNumber },
        });
    }

    // Para RN-02: el tipo de documento no vino; puede haber más de un cliente.
    findByDocumentNumber(documentNumber: string): Promise<Customer[]> {
        return this.customersRepository.find({ where: { documentNumber } });
    }
}