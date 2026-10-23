import { ConflictException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { CreateInvoiceUseCase } from '../../../src/billing/application/create-invoice.use-case';
import { GetReceiptUseCase } from '../../../src/billing/application/get-receipt.use-case';
import { RegisterPaymentUseCase } from '../../../src/billing/application/register-payment.use-case';
import { Invoice } from '../../../src/billing/entities/invoice.entity';
import { InvoiceItem } from '../../../src/billing/entities/invoice-item.entity';
import { Payment } from '../../../src/billing/entities/payment.entity';
import { Receipt } from '../../../src/billing/entities/receipt.entity';
import type { CreateInvoiceCommand } from '../../../src/billing/ports/billing-use-cases.port';
import { Customer } from '../../../src/customers/customer.entity';

// Casos de uso de billing contra PostgreSQL real, con las migraciones aplicadas.
// Si E2E_DATABASE_URL no está definida, la suite se omite (igual que las e2e):
//   docker compose up -d db_test && npm run migration:run   (con DATABASE_URL de la base de pruebas)
//   E2E_DATABASE_URL=postgres://facturacion:facturacion@localhost:5433/facturacion_test npm run test:integration

const DATABASE_URL = process.env.E2E_DATABASE_URL;
const describeWithDb = DATABASE_URL ? describe : describe.skip;

const BILLING = { taxRate: '0.19', maxInvoiceTotal: '50000000.00' };

function configWith(billing: typeof BILLING): ConfigService {
  return { getOrThrow: () => billing } as unknown as ConfigService;
}

describeWithDb('Casos de uso de billing (PostgreSQL)', () => {
  let dataSource: DataSource;
  let customer: Customer;
  let keyCounter = 0;

  let create: CreateInvoiceUseCase;
  let pay: RegisterPaymentUseCase;
  let receipts: GetReceiptUseCase;

  const nextKey = () => `idem-${Date.now()}-${keyCounter++}`;

  const command = (
    overrides: Partial<CreateInvoiceCommand> = {},
  ): CreateInvoiceCommand => ({
    customerId: customer.id,
    items: [
      { description: 'Cambio de aceite', quantity: '1', unitPrice: '80000.00' },
      { description: 'Filtro', quantity: '1', unitPrice: '25000.00' },
    ],
    payment: { method: 'cash', amount: null },
    idempotencyKey: nextKey(),
    source: 'direct',
    externalRef: null,
    ...overrides,
  });

  const count = (entity: new () => unknown) =>
    dataSource.getRepository(entity).count();

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: DATABASE_URL,
      entities: [Customer, Invoice, InvoiceItem, Payment, Receipt],
      synchronize: false,
    });
    await dataSource.initialize();

    const customers = dataSource.getRepository(Customer);
    customer =
      (await customers.findOneBy({
        documentType: 'CC',
        documentNumber: '1032456789',
      })) ??
      (await customers.save(
        customers.create({
          documentType: 'CC',
          documentNumber: '1032456789',
          fullName: 'Cliente de ejemplo',
        }),
      ));

    create = new CreateInvoiceUseCase(dataSource, configWith(BILLING));
    pay = new RegisterPaymentUseCase(dataSource);
    receipts = new GetReceiptUseCase(dataSource);
  });

  afterAll(async () => {
    await dataSource?.destroy();
  });

  beforeEach(async () => {
    await dataSource.query(
      'TRUNCATE receipts, payments, invoice_items, invoices RESTART IDENTITY CASCADE',
    );
  });

  describe('CreateInvoice', () => {
    it('crea la cuenta pagada en efectivo con los totales del ejemplo (sección 7.4)', async () => {
      const result = await create.execute(command());

      expect(result).toMatchObject({
        customer: {
          document_type: 'CC',
          document_number: '****6789',
          full_name: 'Cliente de ejemplo',
        },
        subtotal: '105000.00',
        tax_rate: '0.1900',
        tax_amount: '19950.00',
        total: '124950.00',
        payment: { method: 'cash', amount: '124950.00', status: 'APPLIED' },
        receipt: { receipt_number: 1 },
      });
      expect(result.items).toHaveLength(2);
      expect(result.items).toEqual(
        expect.arrayContaining([
          {
            description: 'Cambio de aceite',
            quantity: 1,
            unit_price: '80000.00',
            line_total: '80000.00',
          },
        ]),
      );
      expect(await count(Invoice)).toBe(1);
      expect(await count(InvoiceItem)).toBe(2);
      expect(await count(Payment)).toBe(1);
      expect(await count(Receipt)).toBe(1);
    });

    it('sin método de pago la cuenta queda PENDING, sin pago ni comprobante (RN-05, RN-09)', async () => {
      const result = await create.execute(command({ payment: null }));

      expect(result.payment).toBeNull();
      expect(result.receipt).toBeNull();
      const [invoice] = await dataSource.getRepository(Invoice).find();
      expect(invoice.status).toBe('PENDING');
      expect(await count(Payment)).toBe(0);
      expect(await count(Receipt)).toBe(0);
    });

    it('guarda en el comprobante una copia con la cédula enmascarada', async () => {
      await create.execute(command());

      const [receipt] = await dataSource.getRepository(Receipt).find();
      expect(receipt.payload).toMatchObject({ total: '124950.00' });
      expect(JSON.stringify(receipt.payload)).not.toContain('1032456789');
    });

    it('con TAX_RATE = 0 el total es igual al subtotal', async () => {
      const noTax = new CreateInvoiceUseCase(
        dataSource,
        configWith({ ...BILLING, taxRate: '0' }),
      );

      const result = await noTax.execute(command());

      expect(result).toMatchObject({
        subtotal: '105000.00',
        tax_rate: '0.0000',
        tax_amount: '0.00',
        total: '105000.00',
      });
    });

    it('asigna comprobantes consecutivos', async () => {
      const first = await create.execute(command());
      const second = await create.execute(command());

      expect(second.receipt!.receipt_number).toBe(
        first.receipt!.receipt_number + 1,
      );
    });

    it.each([
      [
        'total sobre el límite (RN-04)',
        {
          items: [
            { description: 'Motor', quantity: '1', unitPrice: '50000000.00' },
          ],
        },
        'TOTAL_EXCEEDS_LIMIT',
      ],
      [
        'pago distinto del total (RN-06)',
        { payment: { method: 'cash' as const, amount: '1000.00' } },
        'PAYMENT_MISMATCH',
      ],
      [
        'cliente inexistente (RN-01)',
        { customerId: '00000000-0000-4000-8000-000000000000' },
        'CUSTOMER_NOT_FOUND',
      ],
      ['sin ítems (RN-03)', { items: [] }, 'MISSING_FIELDS'],
      [
        'valor unitario inválido',
        { items: [{ description: 'x', quantity: '1', unitPrice: '80.000' }] },
        'INVALID_AMOUNT',
      ],
    ])('rechaza %s sin dejar nada guardado', async (_name, overrides, code) => {
      await expect(create.execute(command(overrides))).rejects.toMatchObject({
        code,
      });

      expect(await count(Invoice)).toBe(0);
      expect(await count(InvoiceItem)).toBe(0);
      expect(await count(Payment)).toBe(0);
      expect(await count(Receipt)).toBe(0);
    });

    it('si falla a mitad de la transacción revierte todo (atomicidad)', async () => {
      const permissive = new CreateInvoiceUseCase(
        dataSource,
        configWith({ ...BILLING, maxInvoiceTotal: '99999999999.00' }),
      );
      // La cantidad desborda numeric(10,2): el ítem falla DESPUÉS de insertar la cuenta.
      const overflow = command({
        items: [
          {
            description: 'Desborde',
            quantity: '123456789012',
            unitPrice: '0.01',
          },
        ],
      });

      await expect(permissive.execute(overflow)).rejects.toThrow(
        /numeric field overflow/i,
      );

      expect(await count(Invoice)).toBe(0);
      expect(await count(InvoiceItem)).toBe(0);
      expect(await count(Receipt)).toBe(0);
    });

    describe('idempotencia (sección 7.6)', () => {
      it('misma clave y mismo cuerpo devuelve el original sin duplicar nada', async () => {
        const original = command();
        const first = await create.execute(original);
        const repeated = await create.execute({ ...original });

        expect(repeated).toEqual(first);
        expect(await count(Invoice)).toBe(1);
        expect(await count(InvoiceItem)).toBe(2);
        expect(await count(Payment)).toBe(1);
        expect(await count(Receipt)).toBe(1);
      });

      it('el orden de los ítems no cambia el cuerpo', async () => {
        const original = command();
        await create.execute(original);

        await expect(
          create.execute({ ...original, items: [...original.items].reverse() }),
        ).resolves.toBeDefined();
        expect(await count(Invoice)).toBe(1);
      });

      it.each([
        [
          'otros ítems',
          {
            items: [{ description: 'Otro', quantity: '1', unitPrice: '1.00' }],
          },
        ],
        ['sin pago', { payment: null }],
        [
          'otro método de pago',
          { payment: { method: 'card' as const, amount: null } },
        ],
        ['otra referencia', { externalRef: 'OT-1' }],
      ])('misma clave con %s responde 409', async (_name, overrides) => {
        const original = command();
        await create.execute(original);

        await expect(
          create.execute({ ...original, ...overrides }),
        ).rejects.toBeInstanceOf(ConflictException);
        expect(await count(Invoice)).toBe(1);
      });

      it('dos peticiones simultáneas con la misma clave crean una sola cuenta', async () => {
        const original = command();

        const [a, b] = await Promise.all([
          create.execute({ ...original }),
          create.execute({ ...original }),
        ]);

        expect(a.invoice_id).toBe(b.invoice_id);
        expect(await count(Invoice)).toBe(1);
        expect(await count(Receipt)).toBe(1);
      });

      it('una solicitud rechazada no consume la clave', async () => {
        const key = nextKey();
        await expect(
          create.execute(command({ idempotencyKey: key, items: [] })),
        ).rejects.toMatchObject({ code: 'MISSING_FIELDS' });

        await expect(
          create.execute(command({ idempotencyKey: key })),
        ).resolves.toBeDefined();
      });
    });
  });

  describe('RegisterPayment', () => {
    const pendingInvoice = () => create.execute(command({ payment: null }));

    it('paga la cuenta PENDING: pasa a PAID y emite el comprobante', async () => {
      const pending = await pendingInvoice();

      const result = await pay.execute({
        invoiceId: pending.invoice_id,
        method: 'card',
        amount: null,
        idempotencyKey: nextKey(),
      });

      expect(result.payment).toEqual({
        method: 'card',
        amount: '124950.00',
        status: 'APPLIED',
      });
      expect(result.receipt).toMatchObject({ receipt_number: 1 });
      const invoice = await dataSource
        .getRepository(Invoice)
        .findOneByOrFail({ id: pending.invoice_id });
      expect(invoice.status).toBe('PAID');
    });

    it('acepta el monto igual al total', async () => {
      const pending = await pendingInvoice();

      await expect(
        pay.execute({
          invoiceId: pending.invoice_id,
          method: 'transfer',
          amount: '124950.00',
          idempotencyKey: nextKey(),
        }),
      ).resolves.toBeDefined();
    });

    it('rechaza un monto distinto del total y la cuenta sigue PENDING (RN-06)', async () => {
      const pending = await pendingInvoice();

      await expect(
        pay.execute({
          invoiceId: pending.invoice_id,
          method: 'cash',
          amount: '1000.00',
          idempotencyKey: nextKey(),
        }),
      ).rejects.toMatchObject({ code: 'PAYMENT_MISMATCH' });

      const invoice = await dataSource
        .getRepository(Invoice)
        .findOneByOrFail({ id: pending.invoice_id });
      expect(invoice.status).toBe('PENDING');
      expect(await count(Payment)).toBe(0);
      expect(await count(Receipt)).toBe(0);
    });

    it('una cuenta PAID rechaza un segundo pago con INVOICE_NOT_PAYABLE (RN-07)', async () => {
      const paid = await create.execute(command());

      await expect(
        pay.execute({
          invoiceId: paid.invoice_id,
          method: 'cash',
          amount: null,
          idempotencyKey: nextKey(),
        }),
      ).rejects.toMatchObject({ code: 'INVOICE_NOT_PAYABLE' });
      expect(await count(Payment)).toBe(1);
    });

    it('responde INVOICE_NOT_FOUND si la cuenta no existe', async () => {
      await expect(
        pay.execute({
          invoiceId: '00000000-0000-4000-8000-000000000000',
          method: 'cash',
          amount: null,
          idempotencyKey: nextKey(),
        }),
      ).rejects.toMatchObject({ code: 'INVOICE_NOT_FOUND' });
    });

    it('dos pagos simultáneos sobre la misma cuenta: solo uno se aplica (bloqueo FOR UPDATE)', async () => {
      const pending = await pendingInvoice();
      const attempt = () =>
        pay.execute({
          invoiceId: pending.invoice_id,
          method: 'cash',
          amount: null,
          idempotencyKey: nextKey(),
        });

      const results = await Promise.allSettled([attempt(), attempt()]);

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const rejected = results.find((r) => r.status === 'rejected');
      expect((rejected as PromiseRejectedResult).reason).toMatchObject({
        code: 'INVOICE_NOT_PAYABLE',
      });
      expect(await count(Payment)).toBe(1);
      expect(await count(Receipt)).toBe(1);
    });
  });

  describe('GetReceipt', () => {
    it('devuelve el comprobante por número y por cuenta', async () => {
      const paid = await create.execute(command());

      const byNumber = await receipts.execute({ receiptNumber: 1 });
      const byInvoice = await receipts.execute({ invoiceId: paid.invoice_id });

      expect(byNumber).toEqual(paid);
      expect(byInvoice).toEqual(paid);
    });

    it('responde RECEIPT_NOT_FOUND si el número no existe', async () => {
      await expect(
        receipts.execute({ receiptNumber: 999 }),
      ).rejects.toMatchObject({ code: 'RECEIPT_NOT_FOUND' });
    });

    it('responde RECEIPT_NOT_FOUND para una cuenta aún sin pagar', async () => {
      const pending = await create.execute(command({ payment: null }));

      await expect(
        receipts.execute({ invoiceId: pending.invoice_id }),
      ).rejects.toMatchObject({ code: 'RECEIPT_NOT_FOUND' });
    });

    it('responde INVOICE_NOT_FOUND si la cuenta no existe', async () => {
      await expect(
        receipts.execute({ invoiceId: '00000000-0000-4000-8000-000000000000' }),
      ).rejects.toMatchObject({ code: 'INVOICE_NOT_FOUND' });
    });
  });
});
