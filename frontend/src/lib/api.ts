// Cliente de la API del servicio. Todo va al mismo origen: en producción lo sirve
// el propio servicio y en desarrollo Vite reenvía las rutas (ver vite.config.ts).

export const SKILLS = [
  'lenguaje_natural',
  'registrar_cliente',
  'crear_cuenta',
  'registrar_pago',
  'consultar_cuenta',
  'consultar_comprobante',
] as const;
export type Skill = (typeof SKILLS)[number];

export interface SkillInfo {
  id: Skill;
  description: string;
}

export interface ServiceInfo {
  name: string;
  description: string;
  version: string;
  a2a: { card_url: string; tasks_url: string; auth: string };
  docs_url: string;
  skills: SkillInfo[];
  scope: { does: string[]; does_not: string[] };
}

export interface Partner {
  id: string;
  slug: string;
  name: string;
  key_prefix: string;
  skills: Skill[];
  active: boolean;
  rate_per_minute: number;
  daily_quota: number;
  created_at: string;
  last_used_at: string | null;
}

export interface PartnerWithKey {
  partner: Partner;
  api_key: string;
  warning: string;
}

export interface Exchange {
  id: string;
  request_id: string;
  skill: string;
  status: string;
  error_code: string | null;
  http_status: number;
  latency_ms: number;
  summary: string | null;
  created_at: string;
}

export interface PublicReceipt {
  receipt_number: number;
  issued_at: string;
  issued_by: string;
  customer_document: string;
  subtotal: string;
  tax_amount: string;
  total: string;
  items: Array<{ description: string; quantity: number; line_total: string }>;
  payment: { method: string; amount: string } | null;
}

export interface RawResponse {
  status: number;
  body: unknown;
}

// Error del servicio, ya interpretado desde el envoltorio del contrato.
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
    message: string,
    readonly retryAfterSeconds: number | null = null,
    readonly missingFields: string[] = [],
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text === '') return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export function toApiError(response: Response, body: unknown): ApiError {
  const data = isRecord(body) && isRecord(body.data) ? body.data : null;
  const code = typeof data?.error_code === 'string' ? data.error_code : null;
  const message =
    isRecord(body) && typeof body.message === 'string'
      ? body.message
      : `Error ${response.status}`;
  const retryAfter = Number(response.headers.get('Retry-After'));
  const missing =
    isRecord(body) && Array.isArray(body.missing_fields)
      ? body.missing_fields.filter((f): f is string => typeof f === 'string')
      : [];
  return new ApiError(
    response.status,
    code,
    message,
    Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : null,
    missing,
  );
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, init);
  } catch {
    throw new ApiError(0, 'NETWORK', 'No se pudo conectar con el servicio.');
  }
  const body = await readBody(response);
  if (!response.ok) throw toApiError(response, body);
  return body as T;
}

const json = (body: unknown): Pick<RequestInit, 'body' | 'headers'> => ({
  body: JSON.stringify(body),
  headers: { 'Content-Type': 'application/json' },
});

const withHeaders = (
  extra: Record<string, string>,
  body?: unknown,
): RequestInit => ({
  headers: {
    ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    ...extra,
  },
  ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
});

export const api = {
  info: () => call<ServiceInfo>('/public/info'),

  health: async (): Promise<boolean> => {
    try {
      const response = await fetch('/health');
      return response.ok;
    } catch {
      return false;
    }
  },

  verifyReceipt: (receiptNumber: number, documentNumber: string) =>
    call<PublicReceipt>('/public/receipts/verify', {
      method: 'POST',
      ...json({
        receipt_number: receiptNumber,
        document_number: documentNumber,
      }),
    }),

  // Consola de pruebas: devuelve la respuesta tal cual (incluidos los errores) para
  // poder mostrarla. La key solo viaja en este encabezado y no se guarda.
  sendTask: async (
    partnerKey: string,
    body: unknown,
    idempotencyKey: string,
  ): Promise<RawResponse> => {
    let response: Response;
    try {
      response = await fetch('/a2a/tasks', {
        method: 'POST',
        ...withHeaders(
          {
            Authorization: `Bearer ${partnerKey}`,
            ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
          },
          body,
        ),
      });
    } catch {
      throw new ApiError(0, 'NETWORK', 'No se pudo conectar con el servicio.');
    }
    return { status: response.status, body: await readBody(response) };
  },

  admin: {
    listPartners: (operatorKey: string) =>
      call<Partner[]>('/admin/partners', withHeaders({ 'X-API-Key': operatorKey })),

    createPartner: (
      operatorKey: string,
      input: {
        slug: string;
        name: string;
        skills: Skill[];
        rate_per_minute?: number;
        daily_quota?: number;
      },
    ) =>
      call<PartnerWithKey>('/admin/partners', {
        method: 'POST',
        ...withHeaders({ 'X-API-Key': operatorKey }, input),
      }),

    updatePartner: (
      operatorKey: string,
      id: string,
      patch: Partial<
        Pick<Partner, 'name' | 'skills' | 'active' | 'rate_per_minute' | 'daily_quota'>
      >,
    ) =>
      call<Partner>(`/admin/partners/${id}`, {
        method: 'PATCH',
        ...withHeaders({ 'X-API-Key': operatorKey }, patch),
      }),

    rotateKey: (operatorKey: string, id: string) =>
      call<PartnerWithKey>(`/admin/partners/${id}/rotate-key`, {
        method: 'POST',
        ...withHeaders({ 'X-API-Key': operatorKey }),
      }),

    exchanges: (operatorKey: string, id: string, limit = 20) =>
      call<Exchange[]>(
        `/admin/partners/${id}/exchanges?limit=${limit}`,
        withHeaders({ 'X-API-Key': operatorKey }),
      ),
  },
};
