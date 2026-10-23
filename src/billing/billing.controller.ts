import {BadRequestException,Body,Controller,Get,Headers,Inject,Param,ParseIntPipe,ParseUUIDPipe,Post,} from '@nestjs/common';
import {ApiCreatedResponse,ApiOkResponse,ApiOperation,ApiResponse,ApiTags,} from '@nestjs/swagger';
import {ApiIdempotencyKey,ApiStandardErrors,ErrorEnvelopeDto,} from '../common/swagger/api-docs.decorators';
import { CustomersService } from '../customers/customers.service';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import {InvoiceResultResponseDto,type InvoiceResultData,} from './dto/invoice-result.dto';
import { RegisterPaymentDto } from './dto/register-payment.dto';
import {AmbiguousCustomerError,CustomerNotFoundError,} from './domain/billing.errors';
import { IdempotencyService } from './idempotency/idempotency.service';
import {CREATE_INVOICE_USE_CASE,GET_RECEIPT_USE_CASE,REGISTER_PAYMENT_USE_CASE,type CreateInvoiceUseCasePort,type GetReceiptUseCasePort,type RegisterPaymentUseCasePort,} from './ports/billing-use-cases.port';
import { InvoiceQueryService } from './queries/invoice-query.service';

const MAX_IDEMPOTENCY_KEY_LENGTH = 100;

function requireIdempotencyKey(value: string | undefined): string {
    const key = value?.trim();
    if (!key) {
        throw new BadRequestException('Falta el encabezado Idempotency-Key.');
    }
    if (key.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
        throw new BadRequestException(
            `Idempotency-Key no puede superar ${MAX_IDEMPOTENCY_KEY_LENGTH} caracteres.`,
        );
    }
    return key;
}

@ApiTags('billing')
@Controller('billing')
@ApiStandardErrors()
export class BillingController {
    constructor(
        private readonly customersService: CustomersService,
        private readonly idempotencyService: IdempotencyService,
        private readonly invoiceQueryService: InvoiceQueryService,
        @Inject(CREATE_INVOICE_USE_CASE)
        private readonly createInvoiceUseCase: CreateInvoiceUseCasePort,
        @Inject(REGISTER_PAYMENT_USE_CASE)
        private readonly registerPaymentUseCase: RegisterPaymentUseCasePort,
        @Inject(GET_RECEIPT_USE_CASE)
        private readonly getReceiptUseCase: GetReceiptUseCasePort,
    ) { }

    @Post('invoices')
    @ApiOperation({
        summary: 'Crea una cuenta de cobro desde JSON estructurado (sin IA)',
        description:
            'Con `payment`, la cuenta se crea y se paga en la misma transacción (RN-05). ' +
            'Repetir la misma Idempotency-Key con el mismo cuerpo devuelve el resultado original.',
    })
    @ApiIdempotencyKey()
    @ApiCreatedResponse({ type: InvoiceResultResponseDto })
    @ApiResponse({
        status: 409,
        description: 'Misma Idempotency-Key con un cuerpo distinto',
        type: ErrorEnvelopeDto,
    })
    @ApiResponse({
        status: 422,
        description: 'Regla de negocio incumplida',
        type: ErrorEnvelopeDto,
    })
    async createInvoice(
        @Headers('idempotency-key') rawKey: string | undefined,
        @Body() dto: CreateInvoiceDto,
    ): Promise<InvoiceResultData> {
        const idempotencyKey = requireIdempotencyKey(rawKey);

        return this.idempotencyService.executeCreateInvoice(
            idempotencyKey,
            dto,
            async () => {
                const customerId = await this.resolveCustomerId(dto);
                return this.createInvoiceUseCase.execute({
                    customerId,
                    items: dto.items.map((item) => ({
                        description: item.description.trim(),
                        quantity: String(item.quantity),
                        unitPrice: item.unit_price,
                    })),
                    payment: dto.payment
                        ? {
                            method: dto.payment.method,
                            amount: dto.payment.amount ?? null,
                        }
                        : null,
                    idempotencyKey,
                    source: 'direct',
                    externalRef: dto.external_ref ?? null,
                });
            },
        );
    }

    @Post('invoices/:id/payments')
    @ApiOperation({ summary: 'Registra un pago simulado sobre una cuenta PENDING' })
    @ApiIdempotencyKey()
    @ApiCreatedResponse({ type: InvoiceResultResponseDto })
    @ApiResponse({
        status: 422,
        description: 'Cuenta no pagable o monto distinto del total',
        type: ErrorEnvelopeDto,
    })
    registerPayment(
        @Param('id', new ParseUUIDPipe()) invoiceId: string,
        @Headers('idempotency-key') rawKey: string | undefined,
        @Body() dto: RegisterPaymentDto,
    ): Promise<InvoiceResultData> {
        const idempotencyKey = requireIdempotencyKey(rawKey);

        return this.registerPaymentUseCase.execute({
            invoiceId,
            method: dto.method,
            amount: dto.amount ?? null,
            idempotencyKey,
        });
    }

    @Get('invoices/:id')
    @ApiOperation({ summary: 'Consulta una cuenta con ítems, totales y pagos' })
    @ApiOkResponse({ type: InvoiceResultResponseDto })
    @ApiResponse({
        status: 404,
        description: 'La cuenta no existe',
        type: ErrorEnvelopeDto,
    })
    getInvoice(
        @Param('id', new ParseUUIDPipe()) invoiceId: string,
    ): Promise<InvoiceResultData> {
        return this.invoiceQueryService.getResultById(invoiceId);
    }

    @Get('receipts/:receiptNumber')
    @ApiOperation({ summary: 'Consulta un comprobante emitido' })
    @ApiOkResponse({ type: InvoiceResultResponseDto })
    @ApiResponse({
        status: 404,
        description: 'El comprobante no existe',
        type: ErrorEnvelopeDto,
    })
    getReceipt(
        @Param('receiptNumber', ParseIntPipe) receiptNumber: number,
    ): Promise<InvoiceResultData> {
        if (receiptNumber < 1) {
            throw new BadRequestException('receiptNumber debe ser mayor que 0.');
        }
        return this.getReceiptUseCase.execute({ receiptNumber });
    }

    // RN-01 y RN-02: el cliente debe existir; sin tipo de documento puede haber varios.
    private async resolveCustomerId(dto: CreateInvoiceDto): Promise<string> {
        const matches = await this.customersService.findByDocument(
            dto.customer.document_type ?? null,
            dto.customer.document_number,
        );
        if (matches.length === 0) {
            throw new CustomerNotFoundError();
        }
        if (matches.length > 1) {
            throw new AmbiguousCustomerError();
        }
        return matches[0].id;
    }
}