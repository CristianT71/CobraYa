import { ConflictException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, IsNull, type EntityManager } from 'typeorm';
import type { AppConfig } from '../../common/config/configuration';
import { Customer } from '../../customers/customer.entity';
import { CustomerNotFoundError } from '../domain/billing.errors';
import {
  buildInvoiceDraft,
  type InvoiceDraft,
  type InvoiceDraftConfig,
} from '../domain/invoice-draft';
import { Money } from '../domain/money';
import type { InvoiceResultData } from '../dto/invoice-result.dto';
import { InvoiceItem } from '../entities/invoice-item.entity';
import { Invoice, type InvoiceStatusValue } from '../entities/invoice.entity';
import { Payment } from '../entities/payment.entity';
import type {
  CreateInvoiceCommand,
  CreateInvoiceUseCasePort,
} from '../ports/billing-use-cases.port';
import {
  isUniqueViolation,
  issueReceipt,
  loadInvoiceWithRelations,
  toResult,
} from './invoice-persistence';

const IDEMPOTENCY_CONSTRAINT = 'uq_invoices_idempotency_key';

// Crea una cuenta de cobro (contrato, secciones 7.6 y 8): valida y calcula con
// el dominio, y guarda cuenta, ítems, pago y comprobante en una sola
// transacción. Con método de pago la cuenta nace PAID (RN-05); sin él, PENDING.
//
// Es idempotente por `idempotencyKey` (sección 7.6): misma clave y mismo
// contenido devuelve la cuenta original; otro contenido responde 409. Así sirve
// igual al camino directo y al camino con IA.
@Injectable()
export class CreateInvoiceUseCase implements CreateInvoiceUseCasePort {
  constructor(
    private readonly dataSource: DataSource,
    private readonly config: ConfigService,
  ) {}

  async execute(command: CreateInvoiceCommand): Promise<InvoiceResultData> {
    const existing = await this.findByKey(command.idempotencyKey);
    if (existing) return this.replay(existing, command);

    // Decide y calcula antes de abrir la transacción: si falla, no toca la base.
    const draft = buildInvoiceDraft(
      { items: command.items, payment: command.payment },
      this.draftConfig(),
    );

    try {
      return await this.dataSource.transaction((manager) =>
        this.persist(manager, command, draft),
      );
    } catch (error) {
      if (!isUniqueViolation(error, IDEMPOTENCY_CONSTRAINT)) throw error;
      // Carrera: otra petición con la misma clave se guardó primero.
      const winner = await this.findByKey(command.idempotencyKey);
      if (!winner) throw error;
      return this.replay(winner, command);
    }
  }

  private async persist(
    manager: EntityManager,
    command: CreateInvoiceCommand,
    draft: InvoiceDraft,
  ): Promise<InvoiceResultData> {
    // RN-01: el cliente debe existir; este caso de uso nunca lo crea.
    const customer = await manager
      .getRepository(Customer)
      // El cliente debe ser del mismo ámbito (negocio o plataforma) que la cuenta.
      .findOneBy({
        id: command.customerId,
        partnerId: command.partnerId ?? IsNull(),
      });
    if (!customer) throw new CustomerNotFoundError();

    const { totals } = draft;
    const inserted = await manager.getRepository(Invoice).insert({
      partnerId: command.partnerId ?? null,
      customerId: customer.id,
      status: draft.status as InvoiceStatusValue,
      subtotal: totals.subtotal.toString(),
      taxRate: totals.taxRate,
      taxAmount: totals.taxAmount.toString(),
      total: totals.total.toString(),
      idempotencyKey: command.idempotencyKey,
      source: command.source,
      externalRef: command.externalRef,
    });
    const invoiceId = (inserted.identifiers[0] as { id: string }).id;

    await manager.getRepository(InvoiceItem).insert(
      totals.lines.map((line, index) => ({
        invoiceId,
        description: command.items[index].description.trim(),
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        lineTotal: line.lineTotal.toString(),
      })),
    );

    if (draft.payment) {
      await manager.getRepository(Payment).insert({
        invoiceId,
        method: draft.payment.method,
        amount: draft.payment.amount.toString(),
        status: draft.payment.status,
      });
    }

    if (draft.issueReceipt) {
      const saved = await loadInvoiceWithRelations(manager, invoiceId);
      await issueReceipt(manager, saved as Invoice);
    }

    return toResult(
      (await loadInvoiceWithRelations(manager, invoiceId)) as Invoice,
    );
  }

  private findByKey(idempotencyKey: string): Promise<Invoice | null> {
    return this.dataSource.getRepository(Invoice).findOne({
      where: { idempotencyKey },
      relations: { customer: true, items: true, payments: true, receipt: true },
    });
  }

  private replay(
    existing: Invoice,
    command: CreateInvoiceCommand,
  ): InvoiceResultData {
    if (!isSameRequest(existing, command)) {
      throw new ConflictException(
        'La Idempotency-Key ya se usó con un cuerpo distinto.',
      );
    }
    return toResult(existing);
  }

  private draftConfig(): InvoiceDraftConfig {
    return this.config.getOrThrow<AppConfig['billing']>('billing');
  }
}

// Compara la petición repetida con lo que quedó guardado. Los ítems se
// comparan como conjunto: el orden no está garantizado en la base.
function isSameRequest(
  existing: Invoice,
  command: CreateInvoiceCommand,
): boolean {
  // Una clave de otro ámbito nunca es "la misma petición": 409 sin revelar nada.
  if ((existing.partnerId ?? null) !== (command.partnerId ?? null))
    return false;
  if (existing.customerId !== command.customerId) return false;
  if (existing.externalRef !== command.externalRef) return false;

  const key = (description: string, quantity: string, unitPrice: string) =>
    [
      description.trim(),
      Money.of(quantity).toString(),
      Money.of(unitPrice).toString(),
    ].join('|');
  const stored = existing.items
    .map((item) => key(item.description, item.quantity, item.unitPrice))
    .sort();
  const incoming = command.items
    .map((item) => key(item.description, item.quantity, item.unitPrice))
    .sort();
  if (
    stored.length !== incoming.length ||
    stored.some((value, index) => value !== incoming[index])
  ) {
    return false;
  }

  const payment = existing.payments[0] ?? null;
  if (command.payment === null) return payment === null;
  if (payment === null || payment.method !== command.payment.method) {
    return false;
  }
  return (
    command.payment.amount === null ||
    Money.of(command.payment.amount).equals(Money.of(payment.amount))
  );
}
