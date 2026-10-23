import type { CatalogError, ErrorCode } from '../../common/errors/error-catalog';

// Provisional: errores del camino directo mientras billing.errors.ts de Jheison
// no esté en Dev. Cumplen la forma CatalogError (propiedad `code` del catálogo),
// que es lo único que el filtro global necesita para traducirlos.
// Cuando su archivo llegue a Dev, se cambian los imports por los de
// billing/domain/billing.errors y se borra este archivo.

abstract class DirectPathError extends Error implements CatalogError {
    abstract readonly code: ErrorCode;

    constructor(
        message: string,
        readonly missingFields: string[] = [],
    ) {
        super(message);
        this.name = new.target.name;
    }
}

// RN-01: el cliente debe existir; el servicio nunca lo crea.
export class CustomerNotFoundError extends DirectPathError {
    readonly code = 'CUSTOMER_NOT_FOUND';

    constructor(message = 'El cliente no existe.') {
        super(message);
    }
}

// RN-02: varios clientes coinciden con el número y falta el tipo de documento.
export class AmbiguousCustomerError extends DirectPathError {
    readonly code = 'AMBIGUOUS_CUSTOMER';

    constructor(
        message = 'Varios clientes coinciden con ese número; indique el tipo de documento.',
    ) {
        super(message, ['customer.document_type']);
    }
}

export class InvoiceNotFoundError extends DirectPathError {
    readonly code = 'INVOICE_NOT_FOUND';

    constructor(message = 'La cuenta de cobro no existe.') {
        super(message);
    }
}