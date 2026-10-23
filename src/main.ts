import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { configureApp, setupSwagger } from './app.setup';
import { frontendDir, serveFrontend } from './frontend.setup';
import { MaskingLogger, logLevelsFrom } from './common/logging/masking-logger';

async function bootstrap() {
  const logger = new MaskingLogger('App', {
    logLevels: logLevelsFrom(process.env.LOG_LEVEL),
  });
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger,
  });

  configureApp(app);
  setupSwagger(app);
  const page = serveFrontend(app);
  app.enableShutdownHooks();

  const port = app.get(ConfigService).getOrThrow<number>('port');
  await app.listen(port);
  logger.log(
    `Servicio escuchando en el puerto ${port}; Swagger en /docs; ` +
      (page
        ? 'página web en /'
        : `sin página web (falta compilarla en ${frontendDir()}: npm run build --prefix frontend)`),
  );
}
void bootstrap();
