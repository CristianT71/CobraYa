import type { BillingGateway } from './billing-gateway.port';
import type { CustomerLookup } from './customer-lookup.port';

// Implementaciones provisionales mientras CustomersModule (Zaidy) y los casos
// de uso de billing (Jheison) no estén en la rama. Permiten arrancar la app y
// que las pruebas reemplacen los tokens; en producción fallarían con 500.
// Se borran cuando agent.module enlace los tokens con los servicios reales.

class NotIntegratedError extends Error {
  readonly code = 'INTERNAL_ERROR';

  constructor(piece: string) {
    super(`${piece} todavía no está integrado en el módulo agent.`);
    this.name = 'NotIntegratedError';
  }
}

export const pendingCustomerLookup: CustomerLookup = {
  findByDocument: () =>
    Promise.reject(new NotIntegratedError('CustomersService')),
};

export const pendingBillingGateway: BillingGateway = {
  createInvoice: () => Promise.reject(new NotIntegratedError('CreateInvoice')),
  registerPayment: () =>
    Promise.reject(new NotIntegratedError('RegisterPayment')),
  getReceipt: () => Promise.reject(new NotIntegratedError('GetReceipt')),
  findPendingInvoiceIds: () =>
    Promise.reject(new NotIntegratedError('Consulta de cuentas pendientes')),
};
