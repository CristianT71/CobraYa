import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import configuration from './common/config/configuration';
import { validateEnv } from './common/config/env.validation';
import { AgentModule } from './agent/agent.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      load: [configuration],
      validate: validateEnv,
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        url: config.getOrThrow<string>('database.url'),
        autoLoadEntities: true,
        // El esquema solo lo cambian las migraciones (sección 5).
        synchronize: false,
        migrationsRun: false,
      }),
    }),
    HealthModule,
    AgentModule,
    // Se agregan a medida que cada módulo llegue a main:
    // CustomersModule (Zaidy), BillingModule (Jheison y Zaidy).
  ],
})
export class AppModule {}
