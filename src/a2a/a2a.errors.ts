// Errores del canal de negocios (A2A). Llevan `code` del catálogo para que el
// filtro global los traduzca (common/errors/error-catalog.ts).

export class RateLimitedError extends Error {
  readonly code = 'RATE_LIMITED';

  constructor(
    message = 'Demasiadas solicitudes; espera antes de volver a intentar.',
  ) {
    super(message);
    this.name = 'RateLimitedError';
  }
}

export class QuotaExceededError extends Error {
  readonly code = 'QUOTA_EXCEEDED';

  constructor(
    message = 'Se agotó la cuota diaria de solicitudes de este negocio.',
  ) {
    super(message);
    this.name = 'QuotaExceededError';
  }
}

export class SkillNotAllowedError extends Error {
  readonly code = 'SKILL_NOT_ALLOWED';

  constructor(skill: string) {
    super(`Este negocio no tiene permiso para la habilidad "${skill}".`);
    this.name = 'SkillNotAllowedError';
  }
}
