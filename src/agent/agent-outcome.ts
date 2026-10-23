import { AgentResponseDto, type AgentStatus } from './dto/agent-response.dto';

// Traducción de los códigos de negocio del catálogo (contrato, sección 9.1) a
// la respuesta del supervisor. LLM_UNAVAILABLE, DB_ERROR e INTERNAL_ERROR no
// están aquí: son status "error" con código HTTP propio y los responde el
// filtro global.

type BusinessStatus = Exclude<AgentStatus, 'completed' | 'error'>;

export const AGENT_ERROR_CATALOG: Record<
  string,
  { status: BusinessStatus; message: string }
> = {
  CUSTOMER_NOT_FOUND: {
    status: 'rejected',
    message: 'El cliente no existe en el sistema.',
  },
  AMBIGUOUS_CUSTOMER: {
    status: 'needs_clarification',
    message:
      'Varios clientes tienen ese número de documento; indica el tipo (CC, NIT o CE).',
  },
  MISSING_FIELDS: {
    status: 'needs_clarification',
    message: 'Faltan datos para completar la solicitud.',
  },
  UNKNOWN_INTENT: {
    status: 'needs_clarification',
    message:
      'No entendí qué operación se pide; puedo crear un cobro, registrar un pago o consultar un comprobante.',
  },
  INVALID_AMOUNT: {
    status: 'needs_clarification',
    message:
      'Hay valores que no son válidos; corrígelos y reenvía la solicitud.',
  },
  TOTAL_EXCEEDS_LIMIT: {
    status: 'rejected',
    message: 'El total supera el máximo permitido por cuenta.',
  },
  PAYMENT_MISMATCH: {
    status: 'rejected',
    message: 'El monto del pago debe ser igual al total de la cuenta.',
  },
  INVOICE_NOT_PAYABLE: {
    status: 'rejected',
    message: 'La cuenta ya está pagada o anulada.',
  },
  EXTRACTION_FAILED: {
    status: 'needs_clarification',
    message: 'No pude interpretar la solicitud; reformúlala con más detalle.',
  },
  // Propuestos: el catálogo 9.1 no cubre una cuenta o un comprobante inexistente.
  INVOICE_NOT_FOUND: {
    status: 'rejected',
    message: 'La cuenta de cobro no existe.',
  },
  RECEIPT_NOT_FOUND: {
    status: 'rejected',
    message: 'El comprobante no existe.',
  },
};

// Resultado de negocio decidido por el propio orquestador.
export class AgentOutcomeError extends Error {
  constructor(
    readonly code: keyof typeof AGENT_ERROR_CATALOG,
    message?: string,
    readonly missingFields: string[] = [],
  ) {
    super(message ?? AGENT_ERROR_CATALOG[code].message);
    this.name = 'AgentOutcomeError';
  }
}

// Convierte un error con `code` del catálogo en respuesta; si no es de
// negocio devuelve null y el llamador lo relanza.
export function toBusinessResponse(
  error: unknown,
  requestId: string,
): AgentResponseDto | null {
  if (!(error instanceof Error) || !('code' in error)) return null;
  const code = error.code;
  if (typeof code !== 'string' || !(code in AGENT_ERROR_CATALOG)) return null;

  const entry = AGENT_ERROR_CATALOG[code];
  const message = error.message || entry.message;
  if (entry.status === 'rejected') {
    return AgentResponseDto.rejected(requestId, message, code);
  }
  const missingFields =
    'missingFields' in error && Array.isArray(error.missingFields)
      ? (error.missingFields as string[])
      : [];
  return AgentResponseDto.needsClarification(requestId, message, missingFields);
}
