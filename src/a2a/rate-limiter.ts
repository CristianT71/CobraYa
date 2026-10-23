// Limitadores en memoria del canal de negocios. Los contadores viven en el
// proceso (una sola réplica); con varias réplicas habría que moverlos a un
// almacén compartido. La memoria tiene tope: nunca crece sin límite.

const MAX_TRACKED_KEYS = 10_000;

export type LimitResult =
  { allowed: true } | { allowed: false; retryAfterMs: number };

// Ventana deslizante: a lo sumo `limit` golpes en los últimos `windowMs`.
export class SlidingWindowLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(private readonly now: () => number = Date.now) {}

  tryHit(key: string, limit: number, windowMs: number): LimitResult {
    const now = this.now();
    const recent = (this.hits.get(key) ?? []).filter(
      (time) => now - time < windowMs,
    );

    if (recent.length >= limit) {
      this.hits.set(key, recent);
      return { allowed: false, retryAfterMs: windowMs - (now - recent[0]) };
    }

    recent.push(now);
    // Se reinserta para que el orden del Map siga siendo "el más reciente al final".
    this.hits.delete(key);
    this.hits.set(key, recent);
    this.evictOldest();
    return { allowed: true };
  }

  private evictOldest(): void {
    while (this.hits.size > MAX_TRACKED_KEYS) {
      const oldest = this.hits.keys().next().value;
      if (oldest === undefined) return;
      this.hits.delete(oldest);
    }
  }
}

export interface LockoutOptions {
  maxFailures: number;
  windowMs: number;
  lockMs: number;
}

export const DEFAULT_LOCKOUT: LockoutOptions = {
  maxFailures: 10,
  windowMs: 5 * 60_000,
  lockMs: 15 * 60_000,
};

// Bloqueo por intentos fallidos de autenticación (por IP): `maxFailures` fallos
// en `windowMs` bloquean la IP durante `lockMs`. Frena la adivinación de keys.
export class FailureLockout {
  private readonly failures = new Map<string, number[]>();
  private readonly lockedUntil = new Map<string, number>();

  constructor(
    private readonly options: LockoutOptions = DEFAULT_LOCKOUT,
    private readonly now: () => number = Date.now,
  ) {}

  // Milisegundos que faltan para el desbloqueo; 0 si no está bloqueada.
  remainingMs(key: string): number {
    const until = this.lockedUntil.get(key);
    if (until === undefined) return 0;
    const remaining = until - this.now();
    if (remaining <= 0) {
      this.lockedUntil.delete(key);
      return 0;
    }
    return remaining;
  }

  recordFailure(key: string): void {
    const now = this.now();
    const recent = (this.failures.get(key) ?? []).filter(
      (time) => now - time < this.options.windowMs,
    );
    recent.push(now);

    if (recent.length >= this.options.maxFailures) {
      this.lockedUntil.set(key, now + this.options.lockMs);
      this.failures.delete(key);
    } else {
      this.failures.delete(key);
      this.failures.set(key, recent);
    }
    this.evict(this.failures);
    this.evict(this.lockedUntil);
  }

  private evict(map: Map<string, unknown>): void {
    while (map.size > MAX_TRACKED_KEYS) {
      const oldest = map.keys().next().value;
      if (oldest === undefined) return;
      map.delete(oldest);
    }
  }
}
