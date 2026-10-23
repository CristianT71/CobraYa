import { MigrationInterface, QueryRunner } from 'typeorm';

// Idempotencia del pago (contrato, sección 7.6: "cada POST que crea o paga exige
// Idempotency-Key"). invoices.idempotency_key ya cubre la creación; esta columna
// permite reconocer un pago repetido y devolver el resultado original.
//
// Es nullable porque el pago que nace junto con la cuenta (RN-05) se identifica
// por la clave de la cuenta. UNIQUE admite varios NULL en PostgreSQL.
export class AddPaymentIdempotencyKey1792627200000 implements MigrationInterface {
  name = 'AddPaymentIdempotencyKey1792627200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE payments ADD COLUMN idempotency_key varchar(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE payments ADD CONSTRAINT uq_payments_idempotency_key UNIQUE (idempotency_key)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE payments DROP CONSTRAINT IF EXISTS uq_payments_idempotency_key`,
    );
    await queryRunner.query(
      `ALTER TABLE payments DROP COLUMN IF EXISTS idempotency_key`,
    );
  }
}
