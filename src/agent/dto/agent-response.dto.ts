import { ApiProperty } from '@nestjs/swagger';
import type { DocumentType, PaymentMethod } from '../llm/extraction.schema';

// Envoltorio único de respuesta del camino con IA (contrato, sección 7.4).

export const AGENT_STATUSES = [
  'completed',
  'needs_clarification',
  'rejected',
  'error',
] as const;
export type AgentStatus = (typeof AGENT_STATUSES)[number];

// Forma de `data` en una respuesta completed de create_invoice o
// register_payment. Todo monto es texto decimal y la cédula va enmascarada.
export interface InvoiceResultData {
  invoice_id: string;
  customer: {
    document_type: DocumentType;
    document_number: string;
    full_name: string;
  };
  items: Array<{
    description: string;
    quantity: number;
    unit_price: string;
    line_total: string;
  }>;
  subtotal: string;
  tax_rate: string;
  tax_amount: string;
  total: string;
  payment: {
    method: PaymentMethod;
    amount: string;
    status: 'APPLIED';
  } | null;
  receipt: { receipt_number: number; issued_at: string } | null;
}

// Forma de `data` en rejected y error (contrato, sección 9).
export interface ErrorData {
  error_code: string;
}

export class AgentResponseDto<T = unknown> {
  @ApiProperty({ enum: AGENT_STATUSES })
  status: AgentStatus;

  @ApiProperty({ example: 'Cuenta de cobro creada y pagada en efectivo.' })
  message: string;

  @ApiProperty({
    type: Object,
    nullable: true,
    description:
      'Resultado en completed, { error_code } en rejected y error, null en needs_clarification',
  })
  data: T | null;

  @ApiProperty({ type: [String], example: [] })
  missing_fields: string[];

  @ApiProperty({ example: 'sup-20261021-0001' })
  request_id: string;

  static completed<T>(
    requestId: string,
    message: string,
    data: T,
  ): AgentResponseDto<T> {
    return AgentResponseDto.build('completed', requestId, message, data, []);
  }

  static needsClarification(
    requestId: string,
    message: string,
    missingFields: string[] = [],
  ): AgentResponseDto<null> {
    return AgentResponseDto.build(
      'needs_clarification',
      requestId,
      message,
      null,
      missingFields,
    );
  }

  static rejected(
    requestId: string,
    message: string,
    errorCode: string,
  ): AgentResponseDto<ErrorData> {
    return AgentResponseDto.build(
      'rejected',
      requestId,
      message,
      {
        error_code: errorCode,
      },
      [],
    );
  }

  static error(
    requestId: string,
    message: string,
    errorCode: string,
  ): AgentResponseDto<ErrorData> {
    return AgentResponseDto.build(
      'error',
      requestId,
      message,
      {
        error_code: errorCode,
      },
      [],
    );
  }

  private static build<T>(
    status: AgentStatus,
    requestId: string,
    message: string,
    data: T | null,
    missingFields: string[],
  ): AgentResponseDto<T> {
    const response = new AgentResponseDto<T>();
    response.status = status;
    response.message = message;
    response.data = data;
    response.missing_fields = missingFields;
    response.request_id = requestId;
    return response;
  }
}
