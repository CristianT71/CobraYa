import { vi } from 'vitest';

export interface FetchCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

type Reply = { status?: number; body?: unknown; headers?: Record<string, string> };
type Handler = (call: FetchCall) => Reply | Promise<Reply> | Error;

export function jsonResponse(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

// Reemplaza fetch por un doble que registra cada llamada y responde con `handler`.
// Un Error devuelto simula un corte de red.
export function mockFetch(handler: Handler) {
  const calls: FetchCall[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, key) => {
      headers[key] = value;
    });
    const call: FetchCall = {
      url: String(input),
      method: (init?.method ?? 'GET').toUpperCase(),
      headers,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body,
    };
    calls.push(call);

    const reply = await handler(call);
    if (reply instanceof Error) throw reply;
    return jsonResponse(reply.body, reply.status ?? 200, reply.headers);
  });
  vi.stubGlobal('fetch', fetchMock);
  return { calls, fetchMock };
}

export const SERVICE_INFO = {
  name: 'Facturación y Pagos',
  description: 'Negocio de facturación.',
  version: '1.1.0',
  a2a: {
    card_url: 'https://facturacion.example.co/.well-known/agent.json',
    tasks_url: 'https://facturacion.example.co/a2a/tasks',
    auth: 'Authorization: Bearer fac_…',
  },
  docs_url: 'https://facturacion.example.co/docs',
  skills: [
    { id: 'lenguaje_natural', description: 'Entiende frases en español.' },
    { id: 'crear_cuenta', description: 'Crea una cuenta de cobro.' },
  ],
  scope: {
    does: ['Cuentas de cobro con cálculo exacto'],
    does_not: ['Facturación electrónica ni DIAN'],
  },
};

export const PARTNER = {
  id: '11111111-1111-4111-8111-111111111111',
  slug: 'concesionario',
  name: 'AutoMax Concesionario',
  key_prefix: 'fac_AbCd',
  skills: [
    'registrar_cliente',
    'crear_cuenta',
    'registrar_pago',
    'consultar_cuenta',
    'consultar_comprobante',
    'lenguaje_natural',
  ],
  active: true,
  rate_per_minute: 30,
  daily_quota: 500,
  created_at: '2026-10-23T15:00:00.000Z',
  last_used_at: null,
};

export const RECEIPT = {
  receipt_number: 7,
  issued_at: '2026-10-21T21:50:00.000Z',
  issued_by: 'AutoMax Concesionario',
  customer_document: '****6789',
  subtotal: '105000.00',
  tax_amount: '19950.00',
  total: '124950.00',
  items: [
    { description: 'Cambio de aceite', quantity: 1, line_total: '80000.00' },
    { description: 'Filtro', quantity: 1, line_total: '25000.00' },
  ],
  payment: { method: 'cash', amount: '124950.00' },
};

export function notFoundEnvelope(code: string, message = 'No existe.') {
  return {
    status: 'rejected',
    message,
    data: { error_code: code },
    missing_fields: [],
    request_id: 'req-1',
  };
}
