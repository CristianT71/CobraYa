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
  /** Resultado de negocio: en /agent/* responde 200 y el detalle va en `status`. */
  business?: true;
}

export const ERROR_CATALOG = {
  // Sección 9.1
  CUSTOMER_NOT_FOUND: { status: 'rejected', httpStatus: 422, business: true },
  AMBIGUOUS_CUSTOMER: {
    status: 'needs_clarification',
    httpStatus: 422,
    business: true,
  },
  MISSING_FIELDS: {
    status: 'needs_clarification',
    httpStatus: 422,
    business: true,
  },
  UNKNOWN_INTENT: {
    status: 'needs_clarification',
    httpStatus: 422,
    business: true,
  },
  INVALID_AMOUNT: {
    status: 'needs_clarification',
    httpStatus: 422,
    business: true,
  },
  TOTAL_EXCEEDS_LIMIT: { status: 'rejected', httpStatus: 422, business: true },
  PAYMENT_MISMATCH: { status: 'rejected', httpStatus: 422, business: true },
  INVOICE_NOT_PAYABLE: { status: 'rejected', httpStatus: 422, business: true },
  EXTRACTION_FAILED: {
    status: 'needs_clarification',
    httpStatus: 200,
    business: true,
  },
  LLM_UNAVAILABLE: { status: 'error', httpStatus: 502 },
  DB_ERROR: { status: 'error', httpStatus: 500 },
  INTERNAL_ERROR: { status: 'error', httpStatus: 500 },
  // Propuestos por el orquestador (Cristian): cuenta o comprobante inexistente.
  // Pendientes de registrar en el contrato.
  INVOICE_NOT_FOUND: { status: 'rejected', httpStatus: 404, business: true },
  RECEIPT_NOT_FOUND: { status: 'rejected', httpStatus: 404, business: true },
  // Errores de plataforma (secciones 7.5 y 10.1). Pendientes de registrar en el contrato.
  // Canal de negocios (A2A) y administración de negocios. Pendientes de registrar en el contrato.
  SKILL_NOT_ALLOWED: { status: 'rejected', httpStatus: 403 },
  RATE_LIMITED: { status: 'rejected', httpStatus: 429 },
  QUOTA_EXCEEDED: { status: 'rejected', httpStatus: 429 },
  PARTNER_EXISTS: { status: 'rejected', httpStatus: 409 },
  PARTNER_NOT_FOUND: { status: 'rejected', httpStatus: 404 },
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
  /** Fuerza un código HTTP. */
  httpStatus?: number;
  /** LLM_UNAVAILABLE por timeout: responde 504 en vez de 502 (LlmUnavailableError). */
  timedOut?: boolean;
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
