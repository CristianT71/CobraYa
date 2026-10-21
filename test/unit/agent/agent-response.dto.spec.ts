import { AgentResponseDto } from '../../../src/agent/dto/agent-response.dto';

describe('AgentResponseDto', () => {
  it('completed lleva data y missing_fields vacío', () => {
    const data = { invoice_id: 'inv-1' };
    expect(AgentResponseDto.completed('sup-1', 'ok', data)).toEqual({
      status: 'completed',
      message: 'ok',
      data,
      missing_fields: [],
      request_id: 'sup-1',
    });
  });

  it('needs_clarification lleva data null y los campos faltantes', () => {
    expect(
      AgentResponseDto.needsClarification(
        'sup-2',
        'Falta el número de documento del cliente.',
        ['customer.document_number'],
      ),
    ).toEqual({
      status: 'needs_clarification',
      message: 'Falta el número de documento del cliente.',
      data: null,
      missing_fields: ['customer.document_number'],
      request_id: 'sup-2',
    });
  });

  it.each([
    [
      'rejected',
      (id: string, msg: string, code: string) =>
        AgentResponseDto.rejected(id, msg, code),
      'CUSTOMER_NOT_FOUND',
    ],
    [
      'error',
      (id: string, msg: string, code: string) =>
        AgentResponseDto.error(id, msg, code),
      'LLM_UNAVAILABLE',
    ],
  ] as const)('%s lleva { error_code } en data', (status, build, code) => {
    expect(build('sup-3', 'motivo', code)).toEqual({
      status,
      message: 'motivo',
      data: { error_code: code },
      missing_fields: [],
      request_id: 'sup-3',
    });
  });
});
