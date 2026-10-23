import { ConflictException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { BillingUseCasesGateway } from '../../../src/agent/ports/billing-use-cases.gateway';
import { CreateInvoiceUseCase } from '../../../src/billing/application/create-invoice.use-case';
import { GetReceiptUseCase } from '../../../src/billing/application/get-receipt.use-case';
import { RegisterPaymentUseCase } from '../../../src/billing/application/register-payment.use-case';
import { Invoice } from '../../../src/billing/entities/invoice.entity';
import { InvoiceItem } from '../../../src/billing/entities/invoice-item.entity';
import { Payment } from '../../../src/billing/entities/payment.entity';
import { Receipt } from '../../../src/billing/entities/receipt.entity';
import type { CreateInvoiceCommand } from '../../../src/billing/ports/billing-use-cases.port';
import { InvoiceQueryService } from '../../../src/billing/queries/invoice-query.service';
import { Customer } from '../../../src/customers/customer.entity';
import { CustomersService } from '../../../src/customers/customers.service';
import { PartnerExchange } from '../../../src/partners/partner-exchange.entity';
import { Partner } from '../../../src/partners/partner.entity';
import { PartnersService } from '../../../src/partners/partners.service';

// Aislamiento entre negocios: cada negocio solo ve y toca lo suyo. Es la garantía
// que permite que varios negocios (concesionario, taller, repuestos...) usen el
// mismo servicio. Contra PostgreSQL real; se omite sin E2E_DATABASE_URL.

const DATABASE_URL = process.env.E2E_DATABASE_URL;
const describeWithDb = DATABASE_URL ? describe : describe.skip;

const BILLING = { taxRate: '0.19', maxInvoiceTotal: '50000000.00' };
const config = (value: unknown) =>
  ({ getOrThrow: () => value }) as unknown as ConfigService;

describeWithDb('Aislamiento entre negocios (PostgreSQL)', () => {
  let dataSource: DataSource;
  let customers: CustomersService;
  let create: CreateInvoiceUseCase;
  let pay: RegisterPaymentUseCase;
  let receipts: GetReceiptUseCase;
  let query: InvoiceQueryService;
  let gateway: BillingUseCasesGateway;

  let a: string;
  let b: string;
  let customerA: string;
  let customerB: string;
  let customerPlatform: string;
  let keyCounter = 0;
  const nextKey = () => `tenancy-${Date.now()}-${keyCounter++}`;

  const command = (
    customerId: string,
    overrides: Partial<CreateInvoiceCommand> = {},
  ): CreateInvoiceCommand => ({
    customerId,
    items: [{ description: 'Filtro', quantity: '1', unitPrice: '25000.00' }],
    payment: null,
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
      entities: [
        Customer,
        Invoice,
        InvoiceItem,
        Payment,
        Receipt,
        Partner,
        PartnerExchange,
      ],
      synchronize: false,
    });
    await dataSource.initialize();
    customers = new CustomersService(dataSource.getRepository(Customer));
    create = new CreateInvoiceUseCase(dataSource, config(BILLING));
    pay = new RegisterPaymentUseCase(dataSource);
    receipts = new GetReceiptUseCase(dataSource);
    query = new InvoiceQueryService(dataSource.getRepository(Invoice));
    gateway = new BillingUseCasesGateway(
      create,
      pay,
      receipts,
      dataSource.getRepository(Invoice),
    );
  });

  afterAll(async () => {
    await dataSource?.destroy();
  });

  beforeEach(async () => {
    await dataSource.query(
      'TRUNCATE partner_exchanges, receipts, payments, invoice_items, invoices RESTART IDENTITY CASCADE',
    );
    await dataSource.query(
      'DELETE FROM customers WHERE partner_id IS NOT NULL',
    );
    await dataSource.query('DELETE FROM partners');

    const partnersService = new PartnersService(
      dataSource.getRepository(Partner),
      config('pepper-de-prueba-'.padEnd(40, 'x')),
    );
    a = (await partnersService.create({ slug: 'negocio-a', name: 'A' })).partner
      .id;
    b = (await partnersService.create({ slug: 'negocio-b', name: 'B' })).partner
      .id;

    const doc = { documentType: 'CC' as const, documentNumber: '700100200' };
    customerA = (
      await customers.register({
        partnerId: a,
        ...doc,
        fullName: 'Cliente de A',
      })
    ).customer.id;
    customerB = (
      await customers.register({
        partnerId: b,
        ...doc,
        fullName: 'Cliente de B',
      })
    ).customer.id;
    customerPlatform = (
      await customers.register({
        partnerId: null,
        documentType: 'CC',
        documentNumber: '700100999',
        fullName: 'Cliente de la plataforma',
      })
    ).customer.id;
  });

  describe('crear cuentas', () => {
    it('la cuenta queda a nombre del negocio', async () => {
      await create.execute(command(customerA, { partnerId: a }));

      const [invoice] = await dataSource.getRepository(Invoice).find();
      expect(invoice.partnerId).toBe(a);
    });

    it('sin negocio la cuenta es de la plataforma', async () => {
      await create.execute(command(customerPlatform));

      const [invoice] = await dataSource.getRepository(Invoice).find();
      expect(invoice.partnerId).toBeNull();
    });

    it.each([
      [
        'un negocio con el cliente de otro negocio',
        () => command(customerB, { partnerId: a }),
      ],
      [
        'un negocio con un cliente de la plataforma',
        () => command(customerPlatform, { partnerId: a }),
      ],
      ['la plataforma con el cliente de un negocio', () => command(customerA)],
    ])(
      'rechaza %s (CUSTOMER_NOT_FOUND) sin guardar nada',
      async (_name, build) => {
        await expect(create.execute(build())).rejects.toMatchObject({
          code: 'CUSTOMER_NOT_FOUND',
        });

        expect(await count(Invoice)).toBe(0);
      },
    );
  });

  describe('pagar cuentas', () => {
    it('un negocio paga sus propias cuentas', async () => {
      const invoice = await create.execute(
        command(customerA, { partnerId: a }),
      );

      const paid = await pay.execute({
        invoiceId: invoice.invoice_id,
        method: 'cash',
        amount: null,
        idempotencyKey: nextKey(),
        partnerId: a,
      });

      expect(paid.payment).toMatchObject({ method: 'cash' });
    });

    it('un negocio no puede pagar la cuenta de otro: es como si no existiera', async () => {
      const invoice = await create.execute(
        command(customerA, { partnerId: a }),
      );

      await expect(
        pay.execute({
          invoiceId: invoice.invoice_id,
          method: 'cash',
          amount: null,
          idempotencyKey: nextKey(),
          partnerId: b,
        }),
      ).rejects.toMatchObject({ code: 'INVOICE_NOT_FOUND' });

      const stored = await dataSource
        .getRepository(Invoice)
        .findOneByOrFail({ id: invoice.invoice_id });
      expect(stored.status).toBe('PENDING');
      expect(await count(Payment)).toBe(0);
      expect(await count(Receipt)).toBe(0);
    });

    it('la respuesta ante una cuenta ajena es idéntica a la de una inexistente', async () => {
      const invoice = await create.execute(
        command(customerA, { partnerId: a }),
      );
      const attempt = (invoiceId: string) =>
        pay
          .execute({
            invoiceId,
            method: 'cash',
            amount: null,
            idempotencyKey: nextKey(),
            partnerId: b,
          })
          .catch((e: Error & { code?: string }) => ({
            code: e.code,
            message: e.message,
          }));

      const foreign = await attempt(invoice.invoice_id);
      const missing = await attempt('00000000-0000-4000-8000-000000000000');

      expect(foreign).toEqual(missing);
    });

    it('el operador (sin negocio) puede pagar cuentas de cualquier negocio', async () => {
      const invoice = await create.execute(
        command(customerA, { partnerId: a }),
      );

      await expect(
        pay.execute({
          invoiceId: invoice.invoice_id,
          method: 'cash',
          amount: null,
          idempotencyKey: nextKey(),
        }),
      ).resolves.toBeDefined();
    });

    it('un negocio no puede pagar cuentas de la plataforma', async () => {
      const invoice = await create.execute(command(customerPlatform));

      await expect(
        pay.execute({
          invoiceId: invoice.invoice_id,
          method: 'cash',
          amount: null,
          idempotencyKey: nextKey(),
          partnerId: a,
        }),
      ).rejects.toMatchObject({ code: 'INVOICE_NOT_FOUND' });
    });
  });

  describe('consultar comprobantes y cuentas', () => {
    const paidByA = () =>
      create.execute(
        command(customerA, {
          partnerId: a,
          payment: { method: 'cash', amount: null },
        }),
      );

    it('un negocio consulta sus comprobantes por número y por cuenta', async () => {
      const paid = await paidByA();
      const number = paid.receipt!.receipt_number;

      await expect(
        receipts.execute({ receiptNumber: number, partnerId: a }),
      ).resolves.toEqual(paid);
      await expect(
        receipts.execute({ invoiceId: paid.invoice_id, partnerId: a }),
      ).resolves.toEqual(paid);
    });

    it('un negocio no ve los comprobantes de otro, ni por número ni por cuenta', async () => {
      const paid = await paidByA();
      const number = paid.receipt!.receipt_number;

      await expect(
        receipts.execute({ receiptNumber: number, partnerId: b }),
      ).rejects.toMatchObject({ code: 'RECEIPT_NOT_FOUND' });
      await expect(
        receipts.execute({ invoiceId: paid.invoice_id, partnerId: b }),
      ).rejects.toMatchObject({ code: 'INVOICE_NOT_FOUND' });
    });

    it('un comprobante ajeno responde igual que uno inexistente (no se puede sondear la numeración)', async () => {
      const paid = await paidByA();
      const attempt = (receiptNumber: number) =>
        receipts
          .execute({ receiptNumber, partnerId: b })
          .catch((e: Error & { code?: string }) => ({
            code: e.code,
            message: e.message,
          }));

      expect(await attempt(paid.receipt!.receipt_number)).toEqual(
        await attempt(99999),
      );
    });

    it('el operador consulta los comprobantes de cualquier negocio', async () => {
      const paid = await paidByA();

      await expect(
        receipts.execute({ receiptNumber: paid.receipt!.receipt_number }),
      ).resolves.toEqual(paid);
    });

    it('consultar una cuenta ajena responde INVOICE_NOT_FOUND', async () => {
      const paid = await paidByA();

      await expect(query.getResultById(paid.invoice_id, a)).resolves.toEqual(
        paid,
      );
      await expect(
        query.getResultById(paid.invoice_id, b),
      ).rejects.toMatchObject({ code: 'INVOICE_NOT_FOUND' });
      await expect(query.getResultById(paid.invoice_id)).resolves.toEqual(paid);
    });
  });

  describe('cuentas pendientes (RN-08)', () => {
    it('solo cuenta las pendientes del negocio', async () => {
      const own = await create.execute(command(customerA, { partnerId: a }));
      await create.execute(command(customerB, { partnerId: b }));

      await expect(
        gateway.findPendingInvoiceIds(customerA, a),
      ).resolves.toEqual([own.invoice_id]);
      await expect(
        gateway.findPendingInvoiceIds(customerA, b),
      ).resolves.toEqual([]);
    });
  });

  describe('idempotencia entre negocios', () => {
    it('la misma clave en otro negocio responde 409 y no devuelve la cuenta del primero', async () => {
      const key = nextKey();
      const original = await create.execute(
        command(customerA, { partnerId: a, idempotencyKey: key }),
      );

      const attempt = create.execute(
        command(customerB, { partnerId: b, idempotencyKey: key }),
      );

      await expect(attempt).rejects.toBeInstanceOf(ConflictException);
      await attempt.catch((e: Error) => {
        expect(e.message).not.toContain(original.invoice_id);
      });
      expect(await count(Invoice)).toBe(1);
    });

    it('la misma clave entre la plataforma y un negocio también es un conflicto', async () => {
      const key = nextKey();
      await create.execute(
        command(customerA, { partnerId: a, idempotencyKey: key }),
      );

      await expect(
        create.execute(command(customerPlatform, { idempotencyKey: key })),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });
});
