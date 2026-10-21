/**
 * Catálogo de errores de la sección 9.1 del contrato y su traducción a la
 * respuesta HTTP. TypeScript puro: billing/domain puede importarlo sin
 * depender de NestJS.
 */
export type ResponseStatus =
  'completed' | 'needs_clarification' | 'rejected' | 'error';

interface CatalogEntry {
  status: Exclude<ResponseStatus, 'completed'>;
  /** Código HTTP en el camino directo y para fallos técnicos (sección 7.5). */
  httpStatus: number;
}

export const ERROR_CATALOG = {
  // Sección 9.1
  CUSTOMER_NOT_FOUND: { status: 'rejected', httpStatus: 422 },
  AMBIGUOUS_CUSTOMER: { status: 'needs_clarification', httpStatus: 422 },
  MISSING_FIELDS: { status: 'needs_clarification', httpStatus: 422 },
  UNKNOWN_INTENT: { status: 'needs_clarification', httpStatus: 422 },
  INVALID_AMOUNT: { status: 'needs_clarification', httpStatus: 422 },
  TOTAL_EXCEEDS_LIMIT: { status: 'rejected', httpStatus: 422 },
  PAYMENT_MISMATCH: { status: 'rejected', httpStatus: 422 },
  INVOICE_NOT_PAYABLE: { status: 'rejected', httpStatus: 422 },
  EXTRACTION_FAILED: { status: 'needs_clarification', httpStatus: 200 },
  LLM_UNAVAILABLE: { status: 'error', httpStatus: 502 },
  DB_ERROR: { status: 'error', httpStatus: 500 },
  INTERNAL_ERROR: { status: 'error', httpStatus: 500 },
  // Errores de plataforma (secciones 7.5 y 10.1). Pendientes de registrar en el contrato.
  VALIDATION_ERROR: { status: 'rejected', httpStatus: 400 },
  UNAUTHORIZED: { status: 'rejected', httpStatus: 401 },
  NOT_FOUND: { status: 'rejected', httpStatus: 404 },
  IDEMPOTENCY_CONFLICT: { status: 'rejected', httpStatus: 409 },
} as const satisfies Record<string, CatalogEntry>;

export type ErrorCode = keyof typeof ERROR_CATALOG;

/**
 * Forma mínima que el filtro global reconoce. Los errores de dominio
 * (billing.errors.ts) y del orquestador solo necesitan una propiedad `code`
 * con un valor del catálogo; no hace falta heredar de ninguna clase.
 */
export interface CatalogError {
  code: ErrorCode;
  message: string;
  /** Para MISSING_FIELDS y similares: rutas como "customer.document_number". */
  missingFields?: string[];
  /** Fuerza un código HTTP, por ejemplo 504 para LLM_UNAVAILABLE por timeout. */
  httpStatus?: number;
}

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && Object.hasOwn(ERROR_CATALOG, value);
}

export function isCatalogError(error: unknown): error is CatalogError {
  return (
    typeof error === 'object' &&
    error !== null &&
    isErrorCode((error as { code?: unknown }).code)
  );
}

/** Envoltorio de respuesta de la sección 7.4. */
export interface ResponseEnvelope<T = unknown> {
  status: ResponseStatus;
  message: string;
  data: T;
  missing_fields: string[];
  request_id: string;
}
