import type { DocumentType } from '../llm/extraction.schema';

// Lo que el orquestador necesita de customers (Zaidy). agent.module enlaza
// este token con CustomersService cuando exista.

export const CUSTOMER_LOOKUP = Symbol('CUSTOMER_LOOKUP');

export interface CustomerSummary {
  id: string;
  document_type: DocumentType;
  document_number: string;
  full_name: string;
}

export interface CustomerLookup {
  /**
   * Busca clientes por documento; nunca crea clientes (RN-01). Sin tipo, busca
   * solo por número y puede devolver más de uno (RN-02).
   */
  findByDocument(
    documentType: DocumentType | null,
    documentNumber: string,
    // Negocio dueño de los clientes; sin él es la plataforma.
    partnerId?: string | null,
  ): Promise<CustomerSummary[]>;
}
