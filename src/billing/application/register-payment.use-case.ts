import { ConflictException, Injectable } from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';
import { InvoiceNotFoundError } from '../domain/billing.errors';
import { planPayment } from '../domain/invoice-draft';
import type { InvoiceStatus } from '../domain/invoice-status.enum';
import { Money } from '../domain/money';
import type { InvoiceResultData } from '../dto/invoice-result.dto';
import { Invoice, type InvoiceStatusValue } from '../entities/invoice.entity';
import { Payment } from '../entities/payment.entity';
import type {
  RegisterPaymentCommand,
  RegisterPaymentUseCasePort,
} from '../ports/billing-use-cases.port';
import { lockInvoiceById } from '../locking/lock-invoice';
import {
  isUniqueViolation,
  issueReceipt,
  loadInvoiceWithRelations,
  toResult,
} from './invoice-persistence';

const PAYMENT_IDEMPOTENCY_CONSTRAINT = 'uq_payments_idempotency_key';

// Registra el pago simulado de una cuenta PENDING (contrato, sección 8):
// bloquea la cuenta, aplica las reglas del dominio (RN-07 y RN-06), guarda el
// pago, la pasa a PAID y emite el comprobante (RN-09), todo en una transacción.
//
// Es idempotente por `idempotencyKey` (sección 7.6): repetir el mismo pago
// devuelve el resultado original sin duplicar nada; la misma clave con otra
// cuenta, método o monto responde 409. La clave se guarda en payments.
@Injectable()
export class RegisterPaymentUseCase implements RegisterPaymentUseCasePort {
  constructor(private readonly dataSource: DataSource) {}

  async execute(command: RegisterPaymentCommand): Promise<InvoiceResultData> {
    try {
      return await this.dataSource.transaction((manager) =>
        this.pay(manager, command),
      );
    } catch (error) {
      // Carrera entre cuentas distintas con la misma clave: la restricción UNIQUE
      // es la garantía final; la que llega segunda no reutiliza la clave.
      if (isUniqueViolation(error, PAYMENT_IDEMPOTENCY_CONSTRAINT)) {
        throw new ConflictException(
          'La Idempotency-Key ya se usó con un cuerpo distinto.',
        );
      }
      throw error;
    }
  }

  private async pay(
    manager: EntityManager,
    command: RegisterPaymentCommand,
  ): Promise<InvoiceResultData> {
    // FOR UPDATE: dos pagos simultáneos sobre la misma cuenta se serializan, y
    // el segundo ve el resultado del primero (replay o INVOICE_NOT_PAYABLE).
    const invoice = await lockInvoiceById(manager, command.invoiceId);
    // La cuenta de otro negocio es indistinguible de una que no existe.
    if (
      !invoice ||
      (command.partnerId !== undefined &&
        invoice.partnerId !== command.partnerId)
    ) {
      throw new InvoiceNotFoundError();
    }

    const replayed = await this.findReplay(manager, command);
    if (replayed) return replayed;

    const decision = planPayment(
      invoice.status as InvoiceStatus,
      Money.of(invoice.total),
      { method: command.method, amount: command.amount },
    );

    await manager.getRepository(Payment).insert({
      invoiceId: invoice.id,
      method: decision.payment.method,
      amount: decision.payment.amount.toString(),
      status: decision.payment.status,
      idempotencyKey: command.idempotencyKey,
    });
    await manager
      .getRepository(Invoice)
      .update(
        { id: invoice.id },
        { status: decision.newStatus as InvoiceStatusValue },
      );

    if (decision.issueReceipt) {
      const paid = await loadInvoiceWithRelations(manager, invoice.id);
      await issueReceipt(manager, paid as Invoice);
    }

    return toResult(
      (await loadInvoiceWithRelations(manager, invoice.id)) as Invoice,
    );
  }

  // Un pago ya guardado con esta clave: mismo contenido → el resultado original;
  // otro contenido → 409. Va antes de RN-07, que rechazaría la cuenta ya PAID.
  private async findReplay(
    manager: EntityManager,
    command: RegisterPaymentCommand,
  ): Promise<InvoiceResultData | null> {
    const existing = await manager
      .getRepository(Payment)
      .findOneBy({ idempotencyKey: command.idempotencyKey });
    if (!existing) return null;

    const sameRequest =
      existing.invoiceId === command.invoiceId &&
      existing.method === command.method &&
      (command.amount === null ||
        Money.of(command.amount).equals(Money.of(existing.amount)));
    if (!sameRequest) {
      throw new ConflictException(
        'La Idempotency-Key ya se usó con un cuerpo distinto.',
      );
    }
    return toResult(
      (await loadInvoiceWithRelations(manager, existing.invoiceId)) as Invoice,
    );
  }
}
