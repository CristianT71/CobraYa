import { DataSource } from 'typeorm';

// Restricciones del esquema (contrato, sección 5.7) contra la base real creada
// por las migraciones: dinero nunca negativo, claves únicas, llaves foráneas y
// valores permitidos. Si E2E_DATABASE_URL no está definida, la suite se omite.

const DATABASE_URL = process.env.E2E_DATABASE_URL;
const describeWithDb = DATABASE_URL ? describe : describe.skip;

describeWithDb('Restricciones del esquema (PostgreSQL)', () => {
  let dataSource: DataSource;
  let customerId: string;
  let counter = 0;

  const key = () => `constraint-${Date.now()}-${counter++}`;

  const insertInvoice = async (
    overrides: Record<string, unknown> = {},
  ): Promise<string> => {
    const v = {
      customer_id: customerId,
      status: 'PENDING',
      subtotal: '100.00',
      tax_rate: '0.1900',
      tax_amount: '19.00',
      total: '119.00',
      idempotency_key: key(),
      source: 'direct',
      ...overrides,
    };
    const rows: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO invoices (customer_id, status, subtotal, tax_rate, tax_amount, total, idempotency_key, source)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [
        v.customer_id,
        v.status,
        v.subtotal,
        v.tax_rate,
        v.tax_amount,
        v.total,
        v.idempotency_key,
        v.source,
      ],
    );
    return rows[0].id;
  };

  const insertItem = (invoiceId: string, o: Record<string, unknown> = {}) => {
    const v = {
      description: 'Filtro',
      quantity: '1.00',
      unit_price: '25000.00',
      line_total: '25000.00',
      ...o,
    };
    return dataSource.query(
      `INSERT INTO invoice_items (invoice_id, description, quantity, unit_price, line_total)
       VALUES ($1, $2, $3, $4, $5)`,
      [invoiceId, v.description, v.quantity, v.unit_price, v.line_total],
    );
  };

  const insertPayment = (
    invoiceId: string,
    o: Record<string, unknown> = {},
  ) => {
    const v = {
      method: 'cash',
      amount: '119.00',
      status: 'APPLIED',
      idempotency_key: null,
      ...o,
    };
    return dataSource.query(
      `INSERT INTO payments (invoice_id, method, amount, status, idempotency_key)
       VALUES ($1, $2, $3, $4, $5)`,
      [invoiceId, v.method, v.amount, v.status, v.idempotency_key],
    );
  };

  const insertReceipt = (invoiceId: string) =>
    dataSource.query(
      `INSERT INTO receipts (invoice_id, payload) VALUES ($1, '{}'::jsonb)
       RETURNING receipt_number`,
      [invoiceId],
    ) as Promise<Array<{ receipt_number: number }>>;

  const count = async (table: string): Promise<number> => {
    const rows: Array<{ n: string }> = await dataSource.query(
      `SELECT count(*) AS n FROM ${table}`,
    );
    return Number(rows[0].n);
  };

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: DATABASE_URL,
      synchronize: false,
    });
    await dataSource.initialize();
    await dataSource.query(
      `INSERT INTO customers (document_type, document_number, full_name)
       VALUES ('CC', '1032456789', 'Cliente de ejemplo') ON CONFLICT DO NOTHING`,
    );
    const rows: Array<{ id: string }> = await dataSource.query(
      `SELECT id FROM customers WHERE document_type = 'CC' AND document_number = '1032456789'`,
    );
    customerId = rows[0].id;
  });

  afterAll(async () => {
    await dataSource?.destroy();
  });

  beforeEach(async () => {
    await dataSource.query(
      'TRUNCATE receipts, payments, invoice_items, invoices RESTART IDENTITY CASCADE',
    );
  });

  describe('el dinero nunca es negativo (CHECK)', () => {
    it.each([
      ['subtotal', 'ck_invoices_subtotal_non_negative'],
      ['tax_rate', 'ck_invoices_tax_rate_non_negative'],
      ['tax_amount', 'ck_invoices_tax_amount_non_negative'],
      ['total', 'ck_invoices_total_non_negative'],
    ])('invoices.%s negativo se rechaza', async (column, constraint) => {
      await expect(insertInvoice({ [column]: '-1.00' })).rejects.toThrow(
        constraint,
      );
      expect(await count('invoices')).toBe(0);
    });

    it.each([
      [{ unit_price: '-1.00' }, 'ck_invoice_items_unit_price_non_negative'],
      [{ line_total: '-1.00' }, 'ck_invoice_items_line_total_non_negative'],
      [{ quantity: '0.00' }, 'ck_invoice_items_quantity_positive'],
      [{ quantity: '-2.00' }, 'ck_invoice_items_quantity_positive'],
    ])('invoice_items con %j se rechaza', async (overrides, constraint) => {
      const invoiceId = await insertInvoice();
      await expect(insertItem(invoiceId, overrides)).rejects.toThrow(
        constraint,
      );
    });

    it.each([['-1.00'], ['0.00']])(
      'payments.amount = %s se rechaza (debe ser mayor que 0)',
      async (amount) => {
        const invoiceId = await insertInvoice();
        await expect(insertPayment(invoiceId, { amount })).rejects.toThrow(
          'ck_payments_amount_positive',
        );
      },
    );

    it('acepta el dinero válido, incluido el cero donde se permite', async () => {
      const invoiceId = await insertInvoice({
        subtotal: '0.00',
        tax_amount: '0.00',
        total: '0.00',
      });
      await expect(
        insertItem(invoiceId, { unit_price: '0.00', line_total: '0.00' }),
      ).resolves.toBeDefined();
    });
  });

  describe('valores permitidos (CHECK)', () => {
    it.each([
      [{ status: 'LOST' }, 'ck_invoices_status'],
      [{ source: 'robot' }, 'ck_invoices_source'],
    ])('invoices con %j se rechaza', async (overrides, constraint) => {
      await expect(insertInvoice(overrides)).rejects.toThrow(constraint);
    });

    it.each([
      [{ method: 'bitcoin' }, 'ck_payments_method'],
      [{ status: 'PENDING' }, 'ck_payments_status'],
    ])('payments con %j se rechaza', async (overrides, constraint) => {
      const invoiceId = await insertInvoice();
      await expect(insertPayment(invoiceId, overrides)).rejects.toThrow(
        constraint,
      );
    });

    it.each([
      ['XX', '123456', 'ck_customers_document_type'],
      ['CC', '12ab56', 'ck_customers_document_number_digits'],
    ])('customers (%s, %s) se rechaza', async (type, number, constraint) => {
      await expect(
        dataSource.query(
          `INSERT INTO customers (document_type, document_number, full_name) VALUES ($1, $2, 'X')`,
          [type, number],
        ),
      ).rejects.toThrow(constraint);
    });
  });

  describe('claves únicas y llaves foráneas', () => {
    it('no admite dos clientes con el mismo tipo y número de documento', async () => {
      await expect(
        dataSource.query(
          `INSERT INTO customers (document_type, document_number, full_name) VALUES ('CC', '1032456789', 'Otro')`,
        ),
      ).rejects.toThrow('uq_customers_scope_document');
    });

    it('sí admite el mismo número con otro tipo de documento', async () => {
      await dataSource.query(
        `INSERT INTO customers (document_type, document_number, full_name)
         VALUES ('CE', '1032456789', 'Extranjero') ON CONFLICT DO NOTHING`,
      );
      expect(
        await count(`customers WHERE document_number = '1032456789'`),
      ).toBe(2);
      await dataSource.query(
        `DELETE FROM customers WHERE document_type = 'CE' AND document_number = '1032456789'`,
      );
    });

    it('invoices.idempotency_key es única', async () => {
      await insertInvoice({ idempotency_key: 'misma-clave' });
      await expect(
        insertInvoice({ idempotency_key: 'misma-clave' }),
      ).rejects.toThrow('uq_invoices_idempotency_key');
      expect(await count('invoices')).toBe(1);
    });

    it('payments.idempotency_key es única, pero admite varios NULL', async () => {
      const a = await insertInvoice();
      const b = await insertInvoice();
      await insertPayment(a, { idempotency_key: 'pago-1' });

      await expect(
        insertPayment(b, { idempotency_key: 'pago-1' }),
      ).rejects.toThrow('uq_payments_idempotency_key');
      await expect(insertPayment(b)).resolves.toBeDefined();
      await expect(insertPayment(b)).resolves.toBeDefined();
    });

    it('una cuenta no puede apuntar a un cliente inexistente', async () => {
      await expect(
        insertInvoice({ customer_id: '00000000-0000-4000-8000-000000000000' }),
      ).rejects.toThrow('fk_invoices_customer');
    });

    it('borrar la cuenta borra sus ítems (ON DELETE CASCADE)', async () => {
      const invoiceId = await insertInvoice();
      await insertItem(invoiceId);
      await insertItem(invoiceId, { description: 'Aceite' });
      expect(await count('invoice_items')).toBe(2);

      await dataSource.query('DELETE FROM invoices WHERE id = $1', [invoiceId]);

      expect(await count('invoice_items')).toBe(0);
    });

    it('una cuenta con pagos no se puede borrar', async () => {
      const invoiceId = await insertInvoice();
      await insertPayment(invoiceId);

      await expect(
        dataSource.query('DELETE FROM invoices WHERE id = $1', [invoiceId]),
      ).rejects.toThrow('fk_payments_invoice');
    });
  });

  describe('comprobantes', () => {
    it('asigna el consecutivo desde la secuencia de PostgreSQL', async () => {
      const [first] = await insertReceipt(await insertInvoice());
      const [second] = await insertReceipt(await insertInvoice());

      expect(second.receipt_number).toBe(first.receipt_number + 1);
    });

    it('una cuenta tiene como máximo un comprobante', async () => {
      const invoiceId = await insertInvoice();
      await insertReceipt(invoiceId);

      await expect(insertReceipt(invoiceId)).rejects.toThrow(
        'uq_receipts_invoice_id',
      );
    });

    it('no admite un comprobante sin payload', async () => {
      const invoiceId = await insertInvoice();
      await expect(
        dataSource.query(`INSERT INTO receipts (invoice_id) VALUES ($1)`, [
          invoiceId,
        ]),
      ).rejects.toThrow(/payload/);
    });
  });

  describe('atomicidad', () => {
    it('si falla una escritura de la transacción no queda nada de las anteriores', async () => {
      await expect(
        dataSource.transaction(async (manager) => {
          const [{ id }] = (await manager.query(
            `INSERT INTO invoices (customer_id, status, subtotal, tax_rate, tax_amount, total, idempotency_key, source)
             VALUES ($1, 'PENDING', '1.00', '0.1900', '0.19', '1.19', $2, 'direct') RETURNING id`,
            [customerId, key()],
          )) as Array<{ id: string }>;
          await manager.query(
            `INSERT INTO invoice_items (invoice_id, description, quantity, unit_price, line_total)
             VALUES ($1, 'ok', '1.00', '1.00', '1.00')`,
            [id],
          );
          // Falla: dinero negativo.
          await manager.query(
            `INSERT INTO payments (invoice_id, method, amount) VALUES ($1, 'cash', '-5.00')`,
            [id],
          );
        }),
      ).rejects.toThrow('ck_payments_amount_positive');

      expect(await count('invoices')).toBe(0);
      expect(await count('invoice_items')).toBe(0);
    });
  });
});
