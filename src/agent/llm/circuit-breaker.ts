// Circuito que corta las llamadas al modelo cuando Fireworks está caído
// (reparto, sección 3.1). Evita que cada solicitud del supervisor espere el
// timeout completo y los reintentos mientras el proveedor no responde.
//
//   closed    → las llamadas pasan; las fallas consecutivas se cuentan.
//   open      → tras `failureThreshold` fallas seguidas, se rechazan las
//               llamadas sin tocar a Fireworks durante `cooldownMs`.
//   half-open → vencido el enfriamiento pasa UNA llamada de prueba: si responde
//               se cierra; si falla, vuelve a abrirse otro `cooldownMs`.

export interface CircuitBreakerOptions {
  failureThreshold: number;
  cooldownMs: number;
}

export type CircuitState = 'closed' | 'open' | 'half-open';

export const DEFAULT_CIRCUIT_OPTIONS: CircuitBreakerOptions = {
  failureThreshold: 5,
  cooldownMs: 30_000,
};

export class CircuitBreaker {
  private failures = 0;
  private openedAt: number | null = null;
  private probing = false;

  constructor(
    private readonly options: CircuitBreakerOptions = DEFAULT_CIRCUIT_OPTIONS,
    private readonly now: () => number = Date.now,
  ) {}

  get state(): CircuitState {
    if (this.openedAt === null) return 'closed';
    return this.now() - this.openedAt >= this.options.cooldownMs
      ? 'half-open'
      : 'open';
  }

  // ¿Se puede llamar al modelo ahora? En half-open reserva la llamada de prueba.
  canAttempt(): boolean {
    switch (this.state) {
      case 'closed':
        return true;
      case 'open':
        return false;
      case 'half-open':
        if (this.probing) return false;
        this.probing = true;
        return true;
    }
  }

  // El proveedor respondió (aunque la salida no sirviera): cierra el circuito.
  recordSuccess(): void {
    this.failures = 0;
    this.openedAt = null;
    this.probing = false;
  }

  // El proveedor no respondió (red, timeout, 5xx o 429, ya agotados los reintentos).
  recordFailure(): void {
    const wasProbing = this.probing;
    this.probing = false;
    this.failures += 1;
    if (wasProbing || this.failures >= this.options.failureThreshold) {
      this.openedAt = this.now();
    }
  }

  // La llamada terminó sin decir nada sobre la salud del proveedor (por ejemplo,
  // un 401 por clave inválida): no cuenta como falla ni como éxito.
  release(): void {
    this.probing = false;
  }
}
