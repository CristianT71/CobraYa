// Errores del registro de negocios. Llevan `code` del catálogo para que el
// filtro global los traduzca (common/errors/error-catalog.ts).

export class PartnerExistsError extends Error {
  readonly code = 'PARTNER_EXISTS';

  constructor(slug: string) {
    super(`Ya existe un negocio con el identificador "${slug}".`);
    this.name = 'PartnerExistsError';
  }
}

export class PartnerNotFoundError extends Error {
  readonly code = 'PARTNER_NOT_FOUND';

  constructor() {
    super('El negocio no existe.');
    this.name = 'PartnerNotFoundError';
  }
}
