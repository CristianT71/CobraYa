import { BadRequestException } from '@nestjs/common';
import { SkillNotAllowedError } from '../../../src/a2a/a2a.errors';
import type { ExchangeAuditService } from '../../../src/a2a/exchange-audit.service';
import { ReceiptLinkService } from '../../../src/receipts/receipt-link.service';
import { TasksService } from '../../../src/a2a/tasks.service';
import type { AgentOrchestrator } from '../../../src/agent/agent.orchestrator';
import { AgentResponseDto } from '../../../src/agent/dto/agent-response.dto';
import { LlmUnavailableError } from '../../../src/agent/llm/llm.errors';
import type { InvoiceResultData } from '../../../src/billing/dto/invoice-result.dto';
import type { InvoiceQueryService } from '../../../src/billing/queries/invoice-query.service';
import type { CustomersService } from '../../../src/customers/customers.service';
import type { Partner } from '../../../src/partners/partner.entity';
import { PARTNER_SKILLS } from '../../../src/partners/skills';

const PARTNER_ID = '11111111-1111-4111-8111-111111111111';
const INVOICE_ID = 'b2f1c0de-0000-4000-8000-000000000001';

const PAID: InvoiceResultData = {
  invoice_id: INVOICE_ID,
  customer: {
    document_type: 'CC',
    document_number: '****6789',
    full_name: 'Cliente de ejemplo',
  },
  items: [
    {
      description: 'Filtro',
      quantity: 1,
      unit_price: '25000.00',
      line_total: '25000.00',
    },
  ],
  subtotal: '25000.00',
  tax_rate: '0.1900',
  tax_amount: '4750.00',
  total: '29750.00',
  payment: { method: 'cash', amount: '29750.00', status: 'APPLIED' },
  receipt: { receipt_number: 3, issued_at: '2026-10-21T16:50:00-05:00' },
};

function partner(overrides: Partial<Partner> = {}): Partner {
  return {
    id: PARTNER_ID,
    slug: 'taller',
    name: 'Taller Falla',
    skills: [...PARTNER_SKILLS],
    active: true,
    ...overrides,
  } as Partner;
}

const CONTEXT = { requestId: 'req-1', idempotencyKey: 'pedido-1' };

function setup() {
  const orchestrator = {
    handle: jest
      .fn()
      .mockResolvedValue(
        AgentResponseDto.completed('req-1', 'Cuenta de cobro creada.', PAID),
      ),
  };
  const customers = {
    findByDocument: jest.fn().mockResolvedValue([]),
    register: jest.fn().mockResolvedValue({
      customer: {
        id: 'cust-1',
        document_type: 'CC',
        document_number: '1032456789',
        full_name: 'Ana Pérez',
      },
      created: true,
    }),
  };
  const invoices = { getResultById: jest.fn().mockResolvedValue(PAID) };
  const create = { execute: jest.fn().mockResolvedValue(PAID) };
  const pay = { execute: jest.fn().mockResolvedValue(PAID) };
  const receipt = { execute: jest.fn().mockResolvedValue(PAID) };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };

  const service = new TasksService(
    orchestrator as unknown as AgentOrchestrator,
    customers as unknown as CustomersService,
    invoices as unknown as InvoiceQueryService,
    create,
    pay,
    receipt,
    audit as unknown as ExchangeAuditService,
    {
      urlFor: (n: number) =>
        `https://facturacion.test/public/receipts/token-${n}/pdf`,
    } as unknown as ReceiptLinkService,
  );
  return {
    service,
    orchestrator,
    customers,
    invoices,
    create,
    pay,
    receipt,
    audit,
  };
}

const lastAudit = (audit: { record: jest.Mock }) =>
  audit.record.mock.calls.at(-1)?.[0] as Record<string, unknown>;

describe('TasksService', () => {
  describe('lenguaje natural', () => {
    it('usa el orquestador dentro del negocio, con la clave propia del negocio', async () => {
      const s = setup();

      const response = await s.service.handle(
        partner(),
        { from: 'automax', message: 'Cóbrale un filtro' },
        CONTEXT,
      );

      expect(s.orchestrator.handle).toHaveBeenCalledWith({
        text: 'Cóbrale un filtro',
        requestId: 'req-1',
        idempotencyKey: 'taller:pedido-1',
        partnerId: PARTNER_ID,
      });
      expect(response.status).toBe('completed');
    });

    it('agrega un answer con el total y el comprobante para el otro chatbot', async () => {
      const s = setup();

      const response = await s.service.handle(
        partner(),
        { message: 'Cóbrale un filtro' },
        CONTEXT,
      );

      expect(response.answer).toContain('Total $29.750');
      expect(response.answer).toContain('Comprobante N.º 3');
      expect(response.message).toBe('Cuenta de cobro creada.');
    });

    it('en una respuesta sin cuenta, answer es el mensaje', async () => {
      const s = setup();
      s.orchestrator.handle.mockResolvedValue(
        AgentResponseDto.needsClarification('req-1', 'Falta la cédula.', [
          'customer.document_number',
        ]),
      );

      const response = await s.service.handle(
        partner(),
        { message: 'Cóbrale algo' },
        CONTEXT,
      );

      expect(response.answer).toBe('Falta la cédula.');
      expect(response.missing_fields).toEqual(['customer.document_number']);
    });

    it('sin clave de idempotencia deja que el orquestador decida (las consultas no la necesitan)', async () => {
      const s = setup();

      await s.service.handle(
        partner(),
        { message: 'comprobante 3' },
        {
          requestId: 'req-1',
        },
      );

      expect(s.orchestrator.handle).toHaveBeenCalledWith(
        expect.objectContaining({ idempotencyKey: undefined }),
      );
    });
  });

  describe('claves de idempotencia', () => {
    it('antepone el identificador del negocio para que dos negocios no choquen', async () => {
      const s = setup();

      await s.service.handle(
        partner({ slug: 'taller' }),
        { message: 'x' },
        CONTEXT,
      );
      await s.service.handle(
        partner({ slug: 'repuestos' }),
        { message: 'x' },
        CONTEXT,
      );

      const keys = s.orchestrator.handle.mock.calls.map(
        ([request]: [{ idempotencyKey: string }]) => request.idempotencyKey,
      );
      expect(keys).toEqual(['taller:pedido-1', 'repuestos:pedido-1']);
    });

    it('acepta la clave en el cuerpo si no viene en el encabezado, y el encabezado manda', async () => {
      const s = setup();

      await s.service.handle(
        partner(),
        { message: 'x', idempotency_key: 'del-cuerpo' },
        { requestId: 'r' },
      );
      await s.service.handle(
        partner(),
        { message: 'x', idempotency_key: 'del-cuerpo' },
        { requestId: 'r', idempotencyKey: 'del-encabezado' },
      );

      const keys = s.orchestrator.handle.mock.calls.map(
        ([request]: [{ idempotencyKey: string }]) => request.idempotencyKey,
      );
      expect(keys).toEqual(['taller:del-cuerpo', 'taller:del-encabezado']);
    });

    it.each([
      ['vacía', '   '],
      ['demasiado larga', 'k'.repeat(80)],
      ['con espacios', 'dos palabras'],
      ['con caracteres de control', 'clave\nmaliciosa'],
      ['con caracteres no ASCII', 'clavé'],
    ])('rechaza con 400 una clave %s', async (_name, key) => {
      const s = setup();

      await expect(
        s.service.handle(
          partner(),
          { message: 'x' },
          {
            requestId: 'r',
            idempotencyKey: key,
          },
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(s.orchestrator.handle).not.toHaveBeenCalled();
    });

    it('acepta una clave de 79 caracteres, el máximo', async () => {
      const s = setup();

      await expect(
        s.service.handle(
          partner(),
          { message: 'x' },
          {
            requestId: 'r',
            idempotencyKey: 'k'.repeat(79),
          },
        ),
      ).resolves.toBeDefined();
    });

    it('el máximo con el identificador más largo cabe en invoices.idempotency_key (100)', async () => {
      const s = setup();

      await s.service.handle(
        partner({ slug: 'a'.repeat(20) }),
        { message: 'x' },
        { requestId: 'r', idempotencyKey: 'k'.repeat(79) },
      );

      const [request] = s.orchestrator.handle.mock.calls[0] as [
        { idempotencyKey: string },
      ];
      expect(request.idempotencyKey.length).toBeLessThanOrEqual(100);
    });
  });

  describe('permisos por habilidad', () => {
    it('rechaza una habilidad que el negocio no tiene', async () => {
      const s = setup();

      await expect(
        s.service.handle(
          partner({ skills: ['consultar_cuenta'] }),
          { skill: 'crear_cuenta', params: {} },
          CONTEXT,
        ),
      ).rejects.toBeInstanceOf(SkillNotAllowedError);
      expect(s.create.execute).not.toHaveBeenCalled();
    });

    it('el lenguaje natural también es una habilidad con permiso propio', async () => {
      const s = setup();

      await expect(
        s.service.handle(
          partner({ skills: ['crear_cuenta'] }),
          { message: 'cóbrale algo' },
          CONTEXT,
        ),
      ).rejects.toBeInstanceOf(SkillNotAllowedError);
      expect(s.orchestrator.handle).not.toHaveBeenCalled();
    });

    it('un negocio de solo lectura puede consultar pero no crear ni pagar', async () => {
      const s = setup();
      const readOnly = partner({
        skills: ['consultar_cuenta', 'consultar_comprobante'],
      });

      await expect(
        s.service.handle(
          readOnly,
          { skill: 'consultar_cuenta', params: { invoice_id: INVOICE_ID } },
          CONTEXT,
        ),
      ).resolves.toBeDefined();
      await expect(
        s.service.handle(
          readOnly,
          { skill: 'registrar_pago', params: {} },
          CONTEXT,
        ),
      ).rejects.toBeInstanceOf(SkillNotAllowedError);
    });
  });

  describe('registrar_cliente', () => {
    const task = {
      skill: 'registrar_cliente',
      params: {
        document_type: 'CC',
        document_number: '1.032.456.789',
        full_name: 'Ana Pérez',
      },
    };

    it('registra al cliente dentro del negocio y devuelve el documento enmascarado', async () => {
      const s = setup();

      const response = await s.service.handle(partner(), task, CONTEXT);

      expect(s.customers.register).toHaveBeenCalledWith({
        partnerId: PARTNER_ID,
        documentType: 'CC',
        documentNumber: '1032456789',
        fullName: 'Ana Pérez',
      });
      expect(response.message).toBe('Cliente registrado.');
      expect(response.data).toEqual({
        customer: {
          document_type: 'CC',
          document_number: '****6789',
          full_name: 'Ana Pérez',
        },
        created: true,
      });
      expect(JSON.stringify(response)).not.toContain('1032456789');
    });

    it('si ya existía lo dice y no lo modifica', async () => {
      const s = setup();
      s.customers.register.mockResolvedValue({
        customer: {
          id: 'c',
          document_type: 'CC',
          document_number: '1032456789',
          full_name: 'Nombre guardado',
        },
        created: false,
      });

      const response = await s.service.handle(partner(), task, CONTEXT);

      expect(response.message).toContain('ya estaba registrado');
      expect((response.data as { created: boolean }).created).toBe(false);
    });

    it('no necesita Idempotency-Key: registrar es idempotente por naturaleza', async () => {
      const s = setup();

      await expect(
        s.service.handle(partner(), task, { requestId: 'r' }),
      ).resolves.toMatchObject({ status: 'completed' });
    });
  });

  describe('crear_cuenta', () => {
    const task = (extra: Record<string, unknown> = {}) => ({
      skill: 'crear_cuenta',
      params: {
        customer: { document_type: 'CC', document_number: '1032456789' },
        items: [{ description: 'Filtro', quantity: 2, unit_price: '25000.00' }],
        ...extra,
      },
    });
    const existing = [
      {
        id: 'cust-1',
        document_type: 'CC',
        document_number: '1032456789',
        full_name: 'Ana Pérez',
      },
    ];

    it('crea la cuenta del cliente del negocio con cantidades y montos como texto', async () => {
      const s = setup();
      s.customers.findByDocument.mockResolvedValue(existing);

      const response = await s.service.handle(
        partner(),
        task({ payment: { method: 'cash' }, external_ref: 'OT-118' }),
        CONTEXT,
      );

      expect(s.customers.findByDocument).toHaveBeenCalledWith(
        'CC',
        '1032456789',
        PARTNER_ID,
      );
      expect(s.create.execute).toHaveBeenCalledWith({
        customerId: 'cust-1',
        items: [
          { description: 'Filtro', quantity: '2', unitPrice: '25000.00' },
        ],
        payment: { method: 'cash', amount: null },
        idempotencyKey: 'taller:pedido-1',
        source: 'direct',
        externalRef: 'OT-118',
        partnerId: PARTNER_ID,
      });
      expect(response.message).toBe(
        'Cuenta de cobro creada y pagada en efectivo.',
      );
      expect(response.answer).toContain('Comprobante N.º 3');
    });

    it('sin pago informa que queda pendiente', async () => {
      const s = setup();
      s.customers.findByDocument.mockResolvedValue(existing);
      s.create.execute.mockResolvedValue({
        ...PAID,
        payment: null,
        receipt: null,
      });

      const response = await s.service.handle(partner(), task(), CONTEXT);

      expect(response.message).toBe(
        'Cuenta de cobro creada; queda pendiente de pago.',
      );
    });

    it('sin Idempotency-Key pide la clave y no toca nada', async () => {
      const s = setup();

      const response = await s.service.handle(partner(), task(), {
        requestId: 'r',
      });

      expect(response).toMatchObject({
        status: 'needs_clarification',
        missing_fields: ['Idempotency-Key'],
      });
      expect(s.customers.findByDocument).not.toHaveBeenCalled();
      expect(s.create.execute).not.toHaveBeenCalled();
    });

    it('un cliente que no existe se rechaza con una pista, sin crearlo', async () => {
      const s = setup();

      await expect(
        s.service.handle(partner(), task(), CONTEXT),
      ).rejects.toMatchObject({
        code: 'CUSTOMER_NOT_FOUND',
        message: expect.stringContaining('registrar_cliente'),
      });
      expect(s.customers.register).not.toHaveBeenCalled();
      expect(s.create.execute).not.toHaveBeenCalled();
    });

    it('con tipo y nombre entregados por el negocio, registra al cliente nuevo en el mismo paso', async () => {
      const s = setup();

      await s.service.handle(
        partner(),
        task({
          customer: {
            document_type: 'CC',
            document_number: '1032456789',
            full_name: 'Ana Pérez',
          },
        }),
        CONTEXT,
      );

      expect(s.customers.register).toHaveBeenCalledWith({
        partnerId: PARTNER_ID,
        documentType: 'CC',
        documentNumber: '1032456789',
        fullName: 'Ana Pérez',
      });
      expect(s.create.execute).toHaveBeenCalledWith(
        expect.objectContaining({ customerId: 'cust-1' }),
      );
    });

    it('solo con nombre y sin tipo no registra: falta el tipo de documento', async () => {
      const s = setup();

      await expect(
        s.service.handle(
          partner(),
          task({
            customer: { document_number: '1032456789', full_name: 'Ana Pérez' },
          }),
          CONTEXT,
        ),
      ).rejects.toMatchObject({ code: 'CUSTOMER_NOT_FOUND' });
      expect(s.customers.register).not.toHaveBeenCalled();
    });

    it('un número en dos tipos de documento pide aclarar el tipo (RN-02)', async () => {
      const s = setup();
      s.customers.findByDocument.mockResolvedValue([
        ...existing,
        { ...existing[0], id: 'cust-2', document_type: 'CE' },
      ]);

      await expect(
        s.service.handle(
          partner(),
          task({ customer: { document_number: '1032456789' } }),
          CONTEXT,
        ),
      ).rejects.toMatchObject({ code: 'AMBIGUOUS_CUSTOMER' });
      expect(s.create.execute).not.toHaveBeenCalled();
    });

    it('los datos inválidos responden 400 con las rutas y no llegan al caso de uso', async () => {
      const s = setup();

      await expect(
        s.service.handle(
          partner(),
          task({
            items: [{ description: 'x', quantity: 1, unit_price: '80 mil' }],
          }),
          CONTEXT,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(s.create.execute).not.toHaveBeenCalled();
    });
  });

  describe('registrar_pago', () => {
    it('paga dentro del negocio con la clave del negocio', async () => {
      const s = setup();

      const response = await s.service.handle(
        partner(),
        {
          skill: 'registrar_pago',
          params: { invoice_id: INVOICE_ID, method: 'transfer' },
        },
        CONTEXT,
      );

      expect(s.pay.execute).toHaveBeenCalledWith({
        invoiceId: INVOICE_ID,
        method: 'transfer',
        amount: null,
        idempotencyKey: 'taller:pedido-1',
        partnerId: PARTNER_ID,
      });
      expect(response.message).toBe('Pago registrado por transferencia.');
    });

    it('sin Idempotency-Key la pide', async () => {
      const s = setup();

      const response = await s.service.handle(
        partner(),
        {
          skill: 'registrar_pago',
          params: { invoice_id: INVOICE_ID, method: 'cash' },
        },
        { requestId: 'r' },
      );

      expect(response.missing_fields).toEqual(['Idempotency-Key']);
      expect(s.pay.execute).not.toHaveBeenCalled();
    });
  });

  describe('consultas', () => {
    it('consultar_cuenta pasa el negocio como ámbito', async () => {
      const s = setup();

      const response = await s.service.handle(
        partner(),
        { skill: 'consultar_cuenta', params: { invoice_id: INVOICE_ID } },
        { requestId: 'r' },
      );

      expect(s.invoices.getResultById).toHaveBeenCalledWith(
        INVOICE_ID,
        PARTNER_ID,
      );
      expect(response.message).toContain('pagada');
    });

    it('consultar_comprobante por número y por cuenta, siempre dentro del negocio', async () => {
      const s = setup();

      await s.service.handle(
        partner(),
        { skill: 'consultar_comprobante', params: { receipt_number: 3 } },
        { requestId: 'r' },
      );
      await s.service.handle(
        partner(),
        { skill: 'consultar_comprobante', params: { invoice_id: INVOICE_ID } },
        { requestId: 'r' },
      );

      expect(s.receipt.execute).toHaveBeenNthCalledWith(1, {
        receiptNumber: 3,
        partnerId: PARTNER_ID,
      });
      expect(s.receipt.execute).toHaveBeenNthCalledWith(2, {
        invoiceId: INVOICE_ID,
        partnerId: PARTNER_ID,
      });
    });
  });

  describe('validación del cuerpo', () => {
    it.each([
      ['vacío', {}],
      ['con una habilidad desconocida', { skill: 'borrar_todo' }],
      ['con un campo no declarado', { message: 'x', admin: true }],
    ])('un cuerpo %s responde 400', async (_name, body) => {
      const s = setup();

      await expect(
        s.service.handle(partner(), body, CONTEXT),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('bitácora de intercambios', () => {
    it('registra un intercambio exitoso con el negocio, la habilidad y el resultado', async () => {
      const s = setup();

      await s.service.handle(
        partner(),
        { message: 'Cóbrale un filtro' },
        CONTEXT,
      );

      expect(lastAudit(s.audit)).toMatchObject({
        partnerId: PARTNER_ID,
        requestId: 'req-1',
        skill: 'lenguaje_natural',
        status: 'completed',
        errorCode: null,
        httpStatus: 200,
        summary: 'Cóbrale un filtro',
      });
      expect(lastAudit(s.audit).latencyMs).toBeGreaterThanOrEqual(0);
    });

    it('en las habilidades estructuradas no guarda los parámetros, solo la habilidad', async () => {
      const s = setup();
      s.customers.findByDocument.mockResolvedValue([
        {
          id: 'c',
          document_type: 'CC',
          document_number: '1032456789',
          full_name: 'Ana Pérez',
        },
      ]);

      await s.service.handle(
        partner(),
        {
          skill: 'crear_cuenta',
          params: {
            customer: { document_type: 'CC', document_number: '1032456789' },
            items: [
              { description: 'Filtro', quantity: 1, unit_price: '25000' },
            ],
          },
        },
        CONTEXT,
      );

      const entry = lastAudit(s.audit);
      expect(entry.skill).toBe('crear_cuenta');
      expect(entry.summary).toBeNull();
      expect(JSON.stringify(entry)).not.toContain('1032456789');
    });

    it('un resultado rejected se registra con su código y HTTP 200', async () => {
      const s = setup();
      s.orchestrator.handle.mockResolvedValue(
        AgentResponseDto.rejected('req-1', 'No existe.', 'CUSTOMER_NOT_FOUND'),
      );

      await s.service.handle(partner(), { message: 'x' }, CONTEXT);

      expect(lastAudit(s.audit)).toMatchObject({
        status: 'rejected',
        errorCode: 'CUSTOMER_NOT_FOUND',
        httpStatus: 200,
      });
    });

    it('un error de dominio se registra como rejected con HTTP 200 y se relanza', async () => {
      const s = setup();
      const error = Object.assign(new Error('No existe'), {
        code: 'INVOICE_NOT_FOUND',
      });
      s.pay.execute.mockRejectedValue(error);

      await expect(
        s.service.handle(
          partner(),
          {
            skill: 'registrar_pago',
            params: { invoice_id: INVOICE_ID, method: 'cash' },
          },
          CONTEXT,
        ),
      ).rejects.toBe(error);

      expect(lastAudit(s.audit)).toMatchObject({
        skill: 'registrar_pago',
        status: 'rejected',
        errorCode: 'INVOICE_NOT_FOUND',
        httpStatus: 200,
      });
    });

    it.each([
      [false, 502],
      [true, 504],
    ])(
      'un modelo caído (timeout=%s) se registra como error con HTTP %i',
      async (timedOut, http) => {
        const s = setup();
        s.orchestrator.handle.mockRejectedValue(
          new LlmUnavailableError('caído', timedOut),
        );

        await expect(
          s.service.handle(partner(), { message: 'x' }, CONTEXT),
        ).rejects.toBeInstanceOf(LlmUnavailableError);

        expect(lastAudit(s.audit)).toMatchObject({
          status: 'error',
          errorCode: 'LLM_UNAVAILABLE',
          httpStatus: http,
        });
      },
    );

    it('un permiso denegado se registra con la habilidad pedida', async () => {
      const s = setup();

      await s.service
        .handle(
          partner({ skills: ['consultar_cuenta'] }),
          { skill: 'crear_cuenta', params: {} },
          CONTEXT,
        )
        .catch(() => undefined);

      expect(lastAudit(s.audit)).toMatchObject({
        skill: 'crear_cuenta',
        status: 'rejected',
        errorCode: 'SKILL_NOT_ALLOWED',
        httpStatus: 403,
      });
    });

    it('un cuerpo inválido se registra como VALIDATION_ERROR 400', async () => {
      const s = setup();

      await s.service.handle(partner(), {}, CONTEXT).catch(() => undefined);

      expect(lastAudit(s.audit)).toMatchObject({
        status: 'rejected',
        errorCode: 'VALIDATION_ERROR',
        httpStatus: 400,
      });
    });

    it('una excepción inesperada se registra como INTERNAL_ERROR 500', async () => {
      const s = setup();
      s.orchestrator.handle.mockRejectedValue(new Error('boom'));

      await s.service
        .handle(partner(), { message: 'x' }, CONTEXT)
        .catch(() => undefined);

      expect(lastAudit(s.audit)).toMatchObject({
        status: 'error',
        errorCode: 'INTERNAL_ERROR',
        httpStatus: 500,
      });
    });
  });
});
