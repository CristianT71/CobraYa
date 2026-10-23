import { ConflictException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Decimal } from 'decimal.js';
import { Repository } from 'typeorm';
import { CreateInvoiceDto } from '../dto/create-invoice.dto';
import type { InvoiceResultData } from '../dto/invoice-result.dto';
import { Invoice } from '../entities/invoice.entity';
import { toInvoiceResultData } from '../mappers/invoice-result.mapper';

const UNIQUE_VIOLATION_CODE = '23505';
const IDEMPOTENCY_CONSTRAINT = 'uq_invoices_idempotency_key';

@Injectable()
export class IdempotencyService {
  constructor(
    @InjectRepository(Invoice)
    private readonly invoicesRepository: Repository<Invoice>,
  ) {}

  /**
   * Ejecuta la creación de la cuenta de forma idempotente (contrato, sección 7.6):
   * - Clave nueva: ejecuta createInvoice y devuelve su resultado.
   * - Misma clave y mismo cuerpo: devuelve la cuenta original sin crear nada.
   * - Misma clave y cuerpo distinto: 409.
   */
  async executeCreateInvoice(
    idempotencyKey: string,
    dto: CreateInvoiceDto,
    createInvoice: () => Promise<InvoiceResultData>,
  ): Promise<InvoiceResultData> {
    const existing = await this.findInvoiceByKey(idempotencyKey);
    if (existing) {
      return this.replay(existing, dto);
    }

    try {
      return await createInvoice();
    } catch (error) {
      if (!this.isIdempotencyViolation(error)) {
        throw error;
      }
      // Carrera: otra petición con la misma clave se guardó primero.
      const winner = await this.findInvoiceByKey(idempotencyKey);
      if (!winner) {
        throw error;
      }
      return this.replay(winner, dto);
    }
  }

  findInvoiceByKey(idempotencyKey: string): Promise<Invoice | null> {
    return this.invoicesRepository.findOne({
      where: { idempotencyKey },
      relations: { customer: true, items: true, payments: true, receipt: true },
    });
  }

  private replay(existing: Invoice, dto: CreateInvoiceDto): InvoiceResultData {
    if (!this.isSameRequest(existing, dto)) {
      throw new ConflictException(
        'La Idempotency-Key ya se usó con un cuerpo distinto.',
      );
    }
    return toInvoiceResultData(existing);
  }

  // Compara la petición repetida contra lo que quedó guardado.
  private isSameRequest(existing: Invoice, dto: CreateInvoiceDto): boolean {
    if (existing.customer.documentNumber !== dto.customer.document_number) {
      return false;
    }
    if (
      dto.customer.document_type &&
      existing.customer.documentType !== dto.customer.document_type
    ) {
      return false;
    }

    // Ítems como conjunto: el orden no está garantizado en la base.
    const stored = existing.items.map((item) =>
      this.itemKey(item.description, item.quantity, item.unitPrice),
    );
    const incoming = dto.items.map((item) =>
      this.itemKey(item.description, item.quantity, item.unit_price),
    );
    if (stored.length !== incoming.length) {
      return false;
    }
    stored.sort();
    incoming.sort();
    if (stored.some((value, index) => value !== incoming[index])) {
      return false;
    }

    if ((dto.external_ref ?? null) !== existing.externalRef) {
      return false;
    }

    // Pago: solo se compara si la petición trae uno.
    if (dto.payment) {
      const payment = existing.payments[0];
      if (!payment || payment.method !== dto.payment.method) {
        return false;
      }
      if (
        dto.payment.amount !== undefined &&
        !new Decimal(payment.amount).equals(new Decimal(dto.payment.amount))
      ) {
        return false;
      }
    }

    return true;
  }

  private itemKey(
    description: string,
    quantity: string | number,
    unitPrice: string | number,
  ): string {
    return [
      description.trim(),
      new Decimal(quantity).toFixed(2),
      new Decimal(unitPrice).toFixed(2),
    ].join('|');
  }

  private isIdempotencyViolation(error: unknown): boolean {
    const err = error as {
      code?: string;
      constraint?: string;
      driverError?: { code?: string; constraint?: string };
    };
    const code = err?.driverError?.code ?? err?.code;
    const constraint = err?.driverError?.constraint ?? err?.constraint;
    return (
      code === UNIQUE_VIOLATION_CODE && constraint === IDEMPOTENCY_CONSTRAINT
    );
  }
}
