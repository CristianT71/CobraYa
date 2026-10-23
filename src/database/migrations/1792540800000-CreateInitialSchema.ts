import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateInitialSchema1792540800000 implements MigrationInterface {
  name = 'CreateInitialSchema1792540800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Secuencia del consecutivo interno de comprobantes
    await queryRunner.query(`CREATE SEQUENCE receipt_number_seq START 1`);

    // customers
    await queryRunner.query(`
        CREATE TABLE customers (
        id uuid NOT NULL DEFAULT gen_random_uuid(),
        document_type varchar(3) NOT NULL,
        document_number varchar(20) NOT NULL,
        full_name varchar(150) NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT pk_customers PRIMARY KEY (id),
        CONSTRAINT uq_customers_document UNIQUE (document_type, document_number),
        CONSTRAINT ck_customers_document_type CHECK (document_type IN ('CC', 'NIT', 'CE')),
        CONSTRAINT ck_customers_document_number_digits CHECK (document_number ~ '^[0-9]+$')
        )
    `);

    // invoices (cuentas de cobro)
    await queryRunner.query(`
        CREATE TABLE invoices (
        id uuid NOT NULL DEFAULT gen_random_uuid(),
        customer_id uuid NOT NULL,
        status varchar(10) NOT NULL DEFAULT 'PENDING',
        subtotal numeric(14,2) NOT NULL,
        tax_rate numeric(5,4) NOT NULL,
        tax_amount numeric(14,2) NOT NULL,
        total numeric(14,2) NOT NULL,
        idempotency_key varchar(100) NOT NULL,
        source varchar(10) NOT NULL,
        external_ref varchar(60),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT pk_invoices PRIMARY KEY (id),
        CONSTRAINT fk_invoices_customer FOREIGN KEY (customer_id) REFERENCES customers (id),
        CONSTRAINT uq_invoices_idempotency_key UNIQUE (idempotency_key),
        CONSTRAINT ck_invoices_status CHECK (status IN ('PENDING', 'PAID', 'CANCELLED')),
        CONSTRAINT ck_invoices_source CHECK (source IN ('agent', 'direct')),
        CONSTRAINT ck_invoices_subtotal_non_negative CHECK (subtotal >= 0),
        CONSTRAINT ck_invoices_tax_rate_non_negative CHECK (tax_rate >= 0),
        CONSTRAINT ck_invoices_tax_amount_non_negative CHECK (tax_amount >= 0),
        CONSTRAINT ck_invoices_total_non_negative CHECK (total >= 0)
        )
    `);
    await queryRunner.query(
      `CREATE INDEX idx_invoices_customer_id ON invoices (customer_id)`,
    );

    // invoice_items
    await queryRunner.query(`
        CREATE TABLE invoice_items (
        id uuid NOT NULL DEFAULT gen_random_uuid(),
        invoice_id uuid NOT NULL,
        description varchar(200) NOT NULL,
        quantity numeric(10,2) NOT NULL,
        unit_price numeric(14,2) NOT NULL,
        line_total numeric(14,2) NOT NULL,
        CONSTRAINT pk_invoice_items PRIMARY KEY (id),
        CONSTRAINT fk_invoice_items_invoice FOREIGN KEY (invoice_id) REFERENCES invoices (id) ON DELETE CASCADE,
        CONSTRAINT ck_invoice_items_quantity_positive CHECK (quantity > 0),
        CONSTRAINT ck_invoice_items_unit_price_non_negative CHECK (unit_price >= 0),
        CONSTRAINT ck_invoice_items_line_total_non_negative CHECK (line_total >= 0)
        )
    `);
    await queryRunner.query(
      `CREATE INDEX idx_invoice_items_invoice_id ON invoice_items (invoice_id)`,
    );

    // payments (pagos simulados)
    await queryRunner.query(`
        CREATE TABLE payments (
        id uuid NOT NULL DEFAULT gen_random_uuid(),
        invoice_id uuid NOT NULL,
        method varchar(10) NOT NULL,
        amount numeric(14,2) NOT NULL,
        status varchar(10) NOT NULL DEFAULT 'APPLIED',
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT pk_payments PRIMARY KEY (id),
        CONSTRAINT fk_payments_invoice FOREIGN KEY (invoice_id) REFERENCES invoices (id),
        CONSTRAINT ck_payments_method CHECK (method IN ('cash', 'card', 'transfer')),
        CONSTRAINT ck_payments_amount_positive CHECK (amount > 0),
        CONSTRAINT ck_payments_status CHECK (status IN ('APPLIED'))
        )
    `);
    await queryRunner.query(
      `CREATE INDEX idx_payments_invoice_id ON payments (invoice_id)`,
    );

    // receipts (comprobantes)
    await queryRunner.query(`
        CREATE TABLE receipts (
        id uuid NOT NULL DEFAULT gen_random_uuid(),
        invoice_id uuid NOT NULL,
        receipt_number integer NOT NULL DEFAULT nextval('receipt_number_seq'),
        payload jsonb NOT NULL,
        issued_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT pk_receipts PRIMARY KEY (id),
        CONSTRAINT fk_receipts_invoice FOREIGN KEY (invoice_id) REFERENCES invoices (id),
        CONSTRAINT uq_receipts_invoice_id UNIQUE (invoice_id),
        CONSTRAINT uq_receipts_receipt_number UNIQUE (receipt_number)
        )
    `);
    await queryRunner.query(
      `ALTER SEQUENCE receipt_number_seq OWNED BY receipts.receipt_number`,
    );

    // llm_call_logs (bitácora del LLM; sin llave foránea, se enlaza por request_id)
    await queryRunner.query(`
        CREATE TABLE llm_call_logs (
        id uuid NOT NULL DEFAULT gen_random_uuid(),
        request_id varchar(64) NOT NULL,
        prompt_version varchar(20) NOT NULL,
        model varchar(80) NOT NULL,
        input_text text NOT NULL,
        raw_output text,
        parsed_ok boolean NOT NULL DEFAULT false,
        attempts smallint NOT NULL DEFAULT 1,
        prompt_tokens integer,
        completion_tokens integer,
        latency_ms integer,
        error text,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT pk_llm_call_logs PRIMARY KEY (id),
        CONSTRAINT ck_llm_call_logs_attempts CHECK (attempts IN (1, 2))
        )
    `);
    await queryRunner.query(
      `CREATE INDEX idx_llm_call_logs_request_id ON llm_call_logs (request_id)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS llm_call_logs`);
    await queryRunner.query(`DROP TABLE IF EXISTS receipts`);
    await queryRunner.query(`DROP TABLE IF EXISTS payments`);
    await queryRunner.query(`DROP TABLE IF EXISTS invoice_items`);
    await queryRunner.query(`DROP TABLE IF EXISTS invoices`);
    await queryRunner.query(`DROP TABLE IF EXISTS customers`);
    await queryRunner.query(`DROP SEQUENCE IF EXISTS receipt_number_seq`);
  }
}
