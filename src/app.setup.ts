import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { ServiceApiKeyGuard } from './common/guards/service-api-key.guard';
import { RequestIdInterceptor } from './common/interceptors/request-id.interceptor';

export const CONTRACT_VERSION = '1.1.0';
export const SWAGGER_PATH = 'docs';

/**
 * Configuración global de la aplicación. La usan main.ts y las pruebas e2e,
 * para que ambas corran con el mismo guard, pipe, interceptor y filtro.
 */
export function configureApp(app: INestApplication): INestApplication {
  // Sin prefijo de rutas: el contrato publica /agent, /billing y /health (sección 12.1).
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  const apiKeyGuard = new ServiceApiKeyGuard(
    app.get(Reflector),
    app.get(ConfigService),
  );
  app.useGlobalGuards(apiKeyGuard);
  app.useGlobalInterceptors(new RequestIdInterceptor());
  app.useGlobalFilters(
    new AllExceptionsFilter((req) => apiKeyGuard.hasValidKey(req)),
  );
  return app;
}

export function setupSwagger(app: INestApplication): void {
  const config = new DocumentBuilder()
    .setTitle('Subagente de Facturación y Pagos')
    .setDescription(
      'Contrato HTTP con el agente supervisor. POST /agent/requests recibe texto libre (con IA); ' +
        '/billing/* recibe JSON estructurado (sin IA). Proyecto educativo: no es facturación electrónica.',
    )
    .setVersion(CONTRACT_VERSION)
    .addApiKey({ type: 'apiKey', name: 'X-API-Key', in: 'header' }, 'api-key')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        description: 'Key de un negocio (fac_…)',
      },
      'partner-key',
    )
    .addSecurityRequirements('api-key')
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup(SWAGGER_PATH, app, document, {
    jsonDocumentUrl: `${SWAGGER_PATH}/json`,
  });
}
