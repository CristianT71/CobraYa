import {
  Body,
  Controller,
  ConflictException,
  Get,
  Global,
  INestApplication,
  Module,
  Post,
} from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { IsString, MaxLength } from 'class-validator';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource, QueryFailedError } from 'typeorm';
import { configureApp, setupSwagger } from '../../src/app.setup';
import configuration from '../../src/common/config/configuration';
import { validateEnv } from '../../src/common/config/env.validation';
import { HealthModule } from '../../src/health/health.module';

const API_KEY = 'clave-de-prueba';

class EchoDto {
  @IsString()
  @MaxLength(20)
  text: string;
}

// Rutas de prueba que imitan lo que harán los módulos de billing y agent.
@Controller()
class FakeController {
  @Post('billing/echo')
  echo(@Body() dto: EchoDto) {
    return { text: dto.text };
  }

  @Get('billing/customer-not-found')
  customerNotFound() {
    throw Object.assign(new Error('El cliente no existe.'), {
      code: 'CUSTOMER_NOT_FOUND',
    });
  }

  @Get('agent/customer-not-found')
  agentCustomerNotFound() {
    throw Object.assign(new Error('El cliente no existe.'), {
      code: 'CUSTOMER_NOT_FOUND',
    });
  }

  @Get('agent/missing-fields')
  missingFields() {
    throw Object.assign(
      new Error('Falta el número de documento del cliente.'),
      {
        code: 'MISSING_FIELDS',
        missingFields: ['customer.document_number'],
      },
    );
  }

  @Get('agent/llm-timeout')
  llmTimeout() {
    throw Object.assign(new Error('Fireworks no respondió a tiempo.'), {
      code: 'LLM_UNAVAILABLE',
      httpStatus: 504,
    });
  }

  @Get('billing/conflict')
  conflict() {
    throw new ConflictException('Idempotency-Key usada con otro cuerpo.');
  }

  @Get('billing/db-error')
  dbError() {
    throw new QueryFailedError('INSERT ...', [], new Error('connection lost'));
  }

  @Get('billing/crash')
  crash() {
    throw new Error('detalle interno con cédula 1032456789');
  }
}

const dataSourceMock = {
  isInitialized: true,
  query: jest.fn().mockResolvedValue([{ '?column?': 1 }]),
};

@Global()
@Module({
  providers: [{ provide: DataSource, useValue: dataSourceMock }],
  exports: [DataSource],
})
class FakeDatabaseModule {}

describe('Plataforma (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    Object.assign(process.env, {
      DATABASE_URL: 'postgres://u:p@localhost:5432/test',
      SERVICE_API_KEY: API_KEY,
      FIREWORKS_API_KEY: 'fw-test',
      FIREWORKS_BASE_URL: 'https://api.fireworks.ai/inference/v1',
      FIREWORKS_MODEL: 'accounts/fireworks/models/gpt-oss-120b',
    });

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [configuration],
          validate: validateEnv,
        }),
        FakeDatabaseModule,
        HealthModule,
      ],
      controllers: [FakeController],
    }).compile();

    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app);
    setupSwagger(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  const authed = (method: 'get' | 'post', path: string) =>
    request(app.getHttpServer())[method](path).set('X-API-Key', API_KEY);

  describe('autenticación', () => {
    it('/health no exige X-API-Key', async () => {
      const res = await request(app.getHttpServer()).get('/health').expect(200);
      expect(res.body).toMatchObject({ status: 'ok', database: 'up' });
    });

    it('/health responde 503 si la base de datos no contesta', async () => {
      dataSourceMock.query.mockRejectedValueOnce(new Error('down'));
      const res = await request(app.getHttpServer()).get('/health').expect(503);
      expect(res.body).toMatchObject({ status: 'error', database: 'down' });
    });

    it('sin X-API-Key responde 401 con el envoltorio', async () => {
      const res = await request(app.getHttpServer())
        .post('/billing/echo')
        .send({ text: 'hola' })
        .expect(401);
      expect(res.body).toMatchObject({
        status: 'rejected',
        data: { error_code: 'UNAUTHORIZED' },
        missing_fields: [],
      });
      expect(res.body.request_id).toEqual(expect.any(String));
    });

    it('con X-API-Key incorrecta responde 401', async () => {
      await request(app.getHttpServer())
        .post('/billing/echo')
        .set('X-API-Key', 'otra-clave')
        .send({ text: 'hola' })
        .expect(401);
    });
  });

  describe('request_id', () => {
    it('propaga el X-Request-Id recibido en encabezado y cuerpo', async () => {
      const res = await authed('post', '/billing/echo')
        .set('X-Request-Id', 'sup-20261021-0001')
        .send({ text: 'hola' })
        .expect(201);
      expect(res.headers['x-request-id']).toBe('sup-20261021-0001');
      expect(res.body).toEqual({
        text: 'hola',
        request_id: 'sup-20261021-0001',
      });
    });

    it('genera uno si no llega', async () => {
      const res = await authed('post', '/billing/echo')
        .send({ text: 'hola' })
        .expect(201);
      expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
      expect(res.body.request_id).toBe(res.headers['x-request-id']);
    });

    it('lo incluye también en las respuestas de error', async () => {
      const res = await request(app.getHttpServer())
        .get('/billing/crash')
        .set('X-Request-Id', 'sup-err-1')
        .expect(401);
      expect(res.headers['x-request-id']).toBe('sup-err-1');
      expect(res.body.request_id).toBe('sup-err-1');
    });
  });

  describe('validación de entrada', () => {
    it('rechaza campos no declarados con 400', async () => {
      const res = await authed('post', '/billing/echo')
        .send({ text: 'hola', extra: 1 })
        .expect(400);
      expect(res.body).toMatchObject({
        status: 'rejected',
        data: { error_code: 'VALIDATION_ERROR' },
      });
      expect(res.body.message).toContain('extra');
    });

    it('rechaza un cuerpo que no cumple el DTO', async () => {
      await authed('post', '/billing/echo')
        .send({ text: 'x'.repeat(21) })
        .expect(400);
    });

    it('rechaza JSON mal formado con el envoltorio', async () => {
      const res = await authed('post', '/billing/echo')
        .set('Content-Type', 'application/json')
        .send('{"text": ')
        .expect(400);
      expect(res.body).toMatchObject({
        status: 'rejected',
        data: { error_code: 'VALIDATION_ERROR' },
      });
    });
  });

  describe('traducción de errores', () => {
    it('error de dominio en el camino directo: 422 rejected', async () => {
      const res = await authed('get', '/billing/customer-not-found').expect(
        422,
      );
      expect(res.body).toMatchObject({
        status: 'rejected',
        message: 'El cliente no existe.',
        data: { error_code: 'CUSTOMER_NOT_FOUND' },
      });
    });

    it('error de dominio en /agent: 200 rejected', async () => {
      const res = await authed('get', '/agent/customer-not-found').expect(200);
      expect(res.body.status).toBe('rejected');
      expect(res.body.data).toEqual({ error_code: 'CUSTOMER_NOT_FOUND' });
    });

    it('needs_clarification en /agent: 200 con missing_fields y data null', async () => {
      const res = await authed('get', '/agent/missing-fields').expect(200);
      expect(res.body).toMatchObject({
        status: 'needs_clarification',
        data: null,
        missing_fields: ['customer.document_number'],
      });
    });

    it('timeout del modelo: 504 error', async () => {
      const res = await authed('get', '/agent/llm-timeout').expect(504);
      expect(res.body).toMatchObject({
        status: 'error',
        data: { error_code: 'LLM_UNAVAILABLE' },
      });
    });

    it('idempotencia con cuerpo distinto: 409', async () => {
      const res = await authed('get', '/billing/conflict').expect(409);
      expect(res.body.data).toEqual({ error_code: 'IDEMPOTENCY_CONFLICT' });
    });

    it('falla de base de datos: 500 DB_ERROR sin detalles internos', async () => {
      const res = await authed('get', '/billing/db-error').expect(500);
      expect(res.body).toMatchObject({
        status: 'error',
        data: { error_code: 'DB_ERROR' },
      });
      expect(res.body.message).not.toContain('connection lost');
    });

    it('excepción no prevista: 500 INTERNAL_ERROR sin filtrar la cédula', async () => {
      const res = await authed('get', '/billing/crash').expect(500);
      expect(res.body.data).toEqual({ error_code: 'INTERNAL_ERROR' });
      expect(JSON.stringify(res.body)).not.toContain('1032456789');
    });

    it('ruta inexistente: 404 con el envoltorio', async () => {
      const res = await authed('get', '/no-existe').expect(404);
      expect(res.body.data).toEqual({ error_code: 'NOT_FOUND' });
    });
  });

  describe('Swagger', () => {
    it('publica el documento OpenAPI con /health y la API key', async () => {
      const res = await request(app.getHttpServer())
        .get('/docs/json')
        .expect(200);
      expect(res.body.paths).toHaveProperty('/health');
      expect(res.body.components.securitySchemes['api-key']).toMatchObject({
        type: 'apiKey',
        name: 'X-API-Key',
        in: 'header',
      });
    });
  });
});
