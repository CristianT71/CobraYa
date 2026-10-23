// Variables de entorno de las pruebas e2e. Se cargan antes de cada archivo de prueba,
// para que ConfigModule las valide al importar AppModule. Nada aquí llama al LLM real.

export const E2E_API_KEY = 'e2e-api-key';

/**
 * Base de PostgreSQL de prueba (la levanta docker compose; ver README).
 * Si no está definida, las suites que necesitan base de datos se omiten.
 */
export const E2E_DATABASE_URL = process.env.E2E_DATABASE_URL;

Object.assign(process.env, {
  DATABASE_URL: E2E_DATABASE_URL ?? 'postgres://e2e:e2e@localhost:5432/e2e',
  SERVICE_API_KEY: E2E_API_KEY,
  FIREWORKS_API_KEY: 'fw-e2e-no-se-usa',
  FIREWORKS_BASE_URL: 'https://api.fireworks.ai/inference/v1',
  FIREWORKS_MODEL: 'accounts/fireworks/models/gpt-oss-120b',
  TAX_RATE: '0.19',
  MAX_INVOICE_TOTAL: '50000000',
  PARTNER_KEY_PEPPER: 'e2e-pepper-solo-para-pruebas-0123456789',
});
