import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
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
  issueReceipt,
  loadInvoiceWithRelations,
  toResult,
} from './invoice-persistence';

// Registra el pago simulado de una cuenta PENDING (contrato, sección 8):
// bloquea la cuenta, aplica las reglas del dominio (RN-07 y RN-06), guarda el
// pago, la pasa a PAID y emite el comprobante (RN-09), todo en una transacción.
//
// Nota sobre idempotencia (sección 7.6): `payments` no guarda la clave, así que
// repetir un pago sobre una cuenta ya PAID responde INVOICE_NOT_PAYABLE en vez
// de devolver el resultado original. Resolverlo exige una columna nueva y su
// migración; queda pendiente de acuerdo con el grupo.
@Injectable()
export class RegisterPaymentUseCase implements RegisterPaymentUseCasePort {
  constructor(private readonly dataSource: DataSource) {}

  execute(command: RegisterPaymentCommand): Promise<InvoiceResultData> {
    return this.dataSource.transaction(async (manager) => {
      // FOR UPDATE: dos pagos simultáneos sobre la misma cuenta se serializan.
      const invoice = await lockInvoiceById(manager, command.invoiceId);
      if (!invoice) throw new InvoiceNotFoundError();

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
    });
  }
}
