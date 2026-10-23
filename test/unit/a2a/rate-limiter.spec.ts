import {
  FailureLockout,
  SlidingWindowLimiter,
} from '../../../src/a2a/rate-limiter';

describe('SlidingWindowLimiter', () => {
  let clock: number;
  let limiter: SlidingWindowLimiter;

  beforeEach(() => {
    clock = 0;
    limiter = new SlidingWindowLimiter(() => clock);
  });

  it('deja pasar hasta el límite dentro de la ventana', () => {
    for (let i = 0; i < 3; i++) {
      expect(limiter.tryHit('a', 3, 1000)).toEqual({ allowed: true });
    }
    expect(limiter.tryHit('a', 3, 1000)).toMatchObject({ allowed: false });
  });

  it('informa cuánto falta para que se libere el primer golpe', () => {
    limiter.tryHit('a', 2, 1000);
    clock = 300;
    limiter.tryHit('a', 2, 1000);
    clock = 400;

    expect(limiter.tryHit('a', 2, 1000)).toEqual({
      allowed: false,
      retryAfterMs: 600,
    });
  });

  it('vuelve a permitir cuando los golpes salen de la ventana', () => {
    limiter.tryHit('a', 1, 1000);
    expect(limiter.tryHit('a', 1, 1000).allowed).toBe(false);

    clock = 1000;

    expect(limiter.tryHit('a', 1, 1000).allowed).toBe(true);
  });

  it('cuenta cada clave por separado', () => {
    limiter.tryHit('a', 1, 1000);

    expect(limiter.tryHit('b', 1, 1000).allowed).toBe(true);
    expect(limiter.tryHit('a', 1, 1000).allowed).toBe(false);
  });

  it('los golpes rechazados no extienden el bloqueo', () => {
    limiter.tryHit('a', 1, 1000);
    for (let i = 0; i < 50; i++) limiter.tryHit('a', 1, 1000);

    clock = 1000;

    expect(limiter.tryHit('a', 1, 1000).allowed).toBe(true);
  });

  it('la memoria tiene tope: no crece sin límite con claves distintas', () => {
    for (let i = 0; i < 12_000; i++) limiter.tryHit(`k${i}`, 1, 1000);

    // Las más antiguas se descartaron (pueden volver a golpear); las recientes se conservan.
    expect(limiter.tryHit('k0', 1, 1000).allowed).toBe(true);
    expect(limiter.tryHit('k11999', 1, 1000).allowed).toBe(false);
  });
});

describe('FailureLockout', () => {
  const OPTIONS = { maxFailures: 3, windowMs: 1000, lockMs: 5000 };
  let clock: number;
  let lockout: FailureLockout;

  beforeEach(() => {
    clock = 0;
    lockout = new FailureLockout(OPTIONS, () => clock);
  });

  it('no bloquea mientras haya menos fallas que el máximo', () => {
    lockout.recordFailure('ip');
    lockout.recordFailure('ip');

    expect(lockout.remainingMs('ip')).toBe(0);
  });

  it('bloquea al llegar al máximo de fallas y dice cuánto falta', () => {
    for (let i = 0; i < 3; i++) lockout.recordFailure('ip');

    expect(lockout.remainingMs('ip')).toBe(5000);
    clock = 2000;
    expect(lockout.remainingMs('ip')).toBe(3000);
  });

  it('se desbloquea solo al vencer el tiempo', () => {
    for (let i = 0; i < 3; i++) lockout.recordFailure('ip');

    clock = 5000;

    expect(lockout.remainingMs('ip')).toBe(0);
  });

  it('las fallas viejas salen de la ventana y no suman', () => {
    lockout.recordFailure('ip');
    lockout.recordFailure('ip');
    clock = 1000;
    lockout.recordFailure('ip');

    expect(lockout.remainingMs('ip')).toBe(0);
  });

  it('cada IP cuenta por separado', () => {
    for (let i = 0; i < 3; i++) lockout.recordFailure('a');

    expect(lockout.remainingMs('a')).toBeGreaterThan(0);
    expect(lockout.remainingMs('b')).toBe(0);
  });

  it('tras el bloqueo empieza de cero', () => {
    for (let i = 0; i < 3; i++) lockout.recordFailure('ip');
    clock = 5000;

    lockout.recordFailure('ip');
    lockout.recordFailure('ip');

    expect(lockout.remainingMs('ip')).toBe(0);
  });
});
