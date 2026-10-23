import type { Repository } from 'typeorm';
import { BillingUseCasesGateway } from '../../../src/agent/ports/billing-use-cases.gateway';
import type { Invoice } from '../../../src/billing/entities/invoice.entity';

// El adaptador solo delega; se comprueba que cada método llegue al caso de uso
// correcto y que la consulta de cuentas pendientes filtre bien.
describe('BillingUseCasesGateway', () => {
  const result = { invoice_id: 'inv-1' };

  function setup(pending: Array<Partial<Invoice>> = []) {
    const create = { execute: jest.fn().mockResolvedValue(result) };
    const payment = { execute: jest.fn().mockResolvedValue(result) };
    const receipt = { execute: jest.fn().mockResolvedValue(result) };
    const find = jest.fn().mockResolvedValue(pending);
    const gateway = new BillingUseCasesGateway(
      create as never,
      payment as never,
      receipt as never,
      {
        find,
      } as unknown as Repository<Invoice>,
    );
    return { gateway, create, payment, receipt, find };
  }

  it('createInvoice delega en el caso de uso CreateInvoice', async () => {
    const { gateway, create } = setup();
    const command = {
      customerId: 'cust-1',
      items: [],
      payment: null,
      idempotencyKey: 'idem-1',
      source: 'agent' as const,
      externalRef: null,
    };

    await expect(gateway.createInvoice(command)).resolves.toBe(result);
    expect(create.execute).toHaveBeenCalledWith(command);
  });

  it('registerPayment delega en el caso de uso RegisterPayment', async () => {
    const { gateway, payment } = setup();
    const command = {
      invoiceId: 'inv-1',
      method: 'card' as const,
      amount: null,
      idempotencyKey: 'idem-2',
    };

    await expect(gateway.registerPayment(command)).resolves.toBe(result);
    expect(payment.execute).toHaveBeenCalledWith(command);
  });

  it('getReceipt delega en el caso de uso GetReceipt', async () => {
    const { gateway, receipt } = setup();

    await expect(gateway.getReceipt({ receiptNumber: 3 })).resolves.toBe(
      result,
    );
    expect(receipt.execute).toHaveBeenCalledWith({ receiptNumber: 3 });
  });

  it('findPendingInvoiceIds consulta solo las cuentas PENDING del cliente', async () => {
    const { gateway, find } = setup([{ id: 'inv-1' }, { id: 'inv-2' }]);

    await expect(gateway.findPendingInvoiceIds('cust-1')).resolves.toEqual([
      'inv-1',
      'inv-2',
    ]);
    expect(find).toHaveBeenCalledWith({
      select: { id: true },
      where: { customerId: 'cust-1', status: 'PENDING' },
    });
  });
});
