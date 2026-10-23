import { CircuitBreaker } from '../../../src/agent/llm/circuit-breaker';

describe('CircuitBreaker', () => {
  const OPTIONS = { failureThreshold: 3, cooldownMs: 1000 };
  let clock: number;
  let breaker: CircuitBreaker;

  beforeEach(() => {
    clock = 0;
    breaker = new CircuitBreaker(OPTIONS, () => clock);
  });

  const fail = (times: number) => {
    for (let i = 0; i < times; i++) breaker.recordFailure();
  };

  it('empieza cerrado y deja pasar las llamadas', () => {
    expect(breaker.state).toBe('closed');
    expect(breaker.canAttempt()).toBe(true);
  });

  it('se abre al llegar al umbral de fallas seguidas', () => {
    fail(2);
    expect(breaker.state).toBe('closed');

    fail(1);

    expect(breaker.state).toBe('open');
    expect(breaker.canAttempt()).toBe(false);
  });

  it('un éxito reinicia la cuenta de fallas', () => {
    fail(2);
    breaker.recordSuccess();
    fail(2);

    expect(breaker.state).toBe('closed');
  });

  it('pasa a half-open al vencer el enfriamiento y deja una sola llamada de prueba', () => {
    fail(3);
    clock = 999;
    expect(breaker.canAttempt()).toBe(false);

    clock = 1000;
    expect(breaker.state).toBe('half-open');
    expect(breaker.canAttempt()).toBe(true);
    expect(breaker.canAttempt()).toBe(false);
  });

  it('la llamada de prueba exitosa cierra el circuito', () => {
    fail(3);
    clock = 1000;
    breaker.canAttempt();

    breaker.recordSuccess();

    expect(breaker.state).toBe('closed');
    expect(breaker.canAttempt()).toBe(true);
  });

  it('la llamada de prueba fallida vuelve a abrirlo otro enfriamiento completo', () => {
    fail(3);
    clock = 1000;
    breaker.canAttempt();

    breaker.recordFailure();

    expect(breaker.state).toBe('open');
    clock = 1999;
    expect(breaker.canAttempt()).toBe(false);
    clock = 2000;
    expect(breaker.canAttempt()).toBe(true);
  });

  it('release libera la llamada de prueba sin contar como falla ni como éxito', () => {
    fail(3);
    clock = 1000;
    breaker.canAttempt();

    breaker.release();

    expect(breaker.state).toBe('half-open');
    expect(breaker.canAttempt()).toBe(true);
  });
});
