import { validateEnv } from '../../../src/common/config/env.validation';

const VALID = {
  DATABASE_URL: 'postgres://u:p@localhost:5432/db',
  SERVICE_API_KEY: 'clave-servicio',
  FIREWORKS_API_KEY: 'fw-key',
  FIREWORKS_BASE_URL: 'https://api.fireworks.ai/inference/v1',
  FIREWORKS_MODEL: 'accounts/fireworks/models/gpt-oss-120b',
};

describe('validateEnv', () => {
  it('acepta las variables obligatorias y convierte los enteros', () => {
    const env = validateEnv({ ...VALID, PORT: '3001', LLM_TIMEOUT_MS: '8000' });
    expect(env.PORT).toBe(3001);
    expect(env.LLM_TIMEOUT_MS).toBe(8000);
  });

  it.each(Object.keys(VALID))('falla si falta %s', (key) => {
    const config: Record<string, string> = { ...VALID };
    delete config[key];
    expect(() => validateEnv(config)).toThrow(key);
  });

  it('mantiene TAX_RATE como texto decimal', () => {
    expect(validateEnv({ ...VALID, TAX_RATE: '0.19' }).TAX_RATE).toBe('0.19');
    expect(validateEnv({ ...VALID, TAX_RATE: '0' }).TAX_RATE).toBe('0');
  });

  it('rechaza tasas y montos mal escritos', () => {
    expect(() => validateEnv({ ...VALID, TAX_RATE: '19%' })).toThrow(
      'TAX_RATE',
    );
    expect(() =>
      validateEnv({ ...VALID, MAX_INVOICE_TOTAL: '50.000.000' }),
    ).toThrow('MAX_INVOICE_TOTAL');
  });

  it('trata una variable opcional vacía como ausente', () => {
    const env = validateEnv({ ...VALID, TAX_RATE: '', PORT: '' });
    expect(env.TAX_RATE).toBeUndefined();
    expect(env.PORT).toBeUndefined();
  });

  it('rechaza un LOG_LEVEL desconocido', () => {
    expect(() => validateEnv({ ...VALID, LOG_LEVEL: 'trace' })).toThrow(
      'LOG_LEVEL',
    );
  });
});
