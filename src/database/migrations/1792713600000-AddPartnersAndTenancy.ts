import { MigrationInterface, QueryRunner } from 'typeorm';

// Varios negocios (concesionario, taller, repuestos...) usan este servicio, cada
// uno con su propia key. Esta migración crea:
//   - partners: los negocios, con la key (solo su hash), permisos y límites.
//   - partner_exchanges: bitácora de cada intercambio con un negocio.
//   - partner_id en customers e invoices: cada negocio solo ve lo suyo.
//
// partner_id NULL es el ámbito de la plataforma (la clave de servicio de
// SERVICE_API_KEY, los clientes semilla y todo lo creado antes de esta migración).
export class AddPartnersAndTenancy1792713600000 implements MigrationInterface {
  name = 'AddPartnersAndTenancy1792713600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE partners (
        id uuid NOT NULL DEFAULT gen_random_uuid(),
        slug varchar(20) NOT NULL,
        name varchar(80) NOT NULL,
        key_hash varchar(64) NOT NULL,
        key_prefix varchar(12) NOT NULL,
        skills text[] NOT NULL,
        active boolean NOT NULL DEFAULT true,
        rate_per_minute integer NOT NULL DEFAULT 30,
        daily_quota integer NOT NULL DEFAULT 500,
        created_at timestamptz NOT NULL DEFAULT now(),
        last_used_at timestamptz,
        CONSTRAINT pk_partners PRIMARY KEY (id),
        CONSTRAINT uq_partners_slug UNIQUE (slug),
        CONSTRAINT uq_partners_key_hash UNIQUE (key_hash),
        CONSTRAINT ck_partners_slug CHECK (slug ~ '^[a-z][a-z0-9-]{1,19}$'),
        CONSTRAINT ck_partners_rate_per_minute CHECK (rate_per_minute BETWEEN 1 AND 600),
        CONSTRAINT ck_partners_daily_quota CHECK (daily_quota BETWEEN 1 AND 100000)
      )
    `);

    // Los clientes pasan a ser de cada negocio: el mismo documento puede existir
    // en varios negocios, pero una sola vez dentro de cada uno.
    await queryRunner.query(
      `ALTER TABLE customers ADD COLUMN partner_id uuid REFERENCES partners (id)`,
    );
    await queryRunner.query(
      `ALTER TABLE customers DROP CONSTRAINT uq_customers_document`,
    );
    await queryRunner.query(`
      CREATE UNIQUE INDEX uq_customers_scope_document
        ON customers (COALESCE(partner_id, '00000000-0000-0000-0000-000000000000'::uuid), document_type, document_number)
    `);
    await queryRunner.query(
      `CREATE INDEX idx_customers_partner_id ON customers (partner_id)`,
    );

    await queryRunner.query(
      `ALTER TABLE invoices ADD COLUMN partner_id uuid REFERENCES partners (id)`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_invoices_partner_id ON invoices (partner_id)`,
    );

    await queryRunner.query(`
      CREATE TABLE partner_exchanges (
        id uuid NOT NULL DEFAULT gen_random_uuid(),
        partner_id uuid NOT NULL,
        request_id varchar(64) NOT NULL,
        skill varchar(30) NOT NULL,
        status varchar(20) NOT NULL,
        error_code varchar(40),
        http_status smallint NOT NULL,
        latency_ms integer NOT NULL,
        summary text,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT pk_partner_exchanges PRIMARY KEY (id),
        CONSTRAINT fk_partner_exchanges_partner FOREIGN KEY (partner_id) REFERENCES partners (id)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX idx_partner_exchanges_partner_created ON partner_exchanges (partner_id, created_at DESC)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS partner_exchanges`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_invoices_partner_id`);
    await queryRunner.query(
      `ALTER TABLE invoices DROP COLUMN IF EXISTS partner_id`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS idx_customers_partner_id`);
    await queryRunner.query(`DROP INDEX IF EXISTS uq_customers_scope_document`);
    // Fallaría si dos negocios ya tienen el mismo documento: hay que limpiar antes.
    await queryRunner.query(
      `ALTER TABLE customers ADD CONSTRAINT uq_customers_document UNIQUE (document_type, document_number)`,
    );
    await queryRunner.query(
      `ALTER TABLE customers DROP COLUMN IF EXISTS partner_id`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS partners`);
  }
}
