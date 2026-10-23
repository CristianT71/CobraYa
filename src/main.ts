import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { configureApp, setupSwagger } from './app.setup';
import { MaskingLogger, logLevelsFrom } from './common/logging/masking-logger';

async function bootstrap() {
  const logger = new MaskingLogger('App', {
    logLevels: logLevelsFrom(process.env.LOG_LEVEL),
  });
  const app = await NestFactory.create(AppModule, { logger });

  configureApp(app);
  setupSwagger(app);
  app.enableShutdownHooks();

  const port = app.get(ConfigService).getOrThrow<number>('port');
  await app.listen(port);
  logger.log(`Servicio escuchando en el puerto ${port}; Swagger en /docs`);
}
void bootstrap();
