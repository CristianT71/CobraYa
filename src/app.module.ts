import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import configuration from './common/config/configuration';
import { validateEnv } from './common/config/env.validation';
import { A2aModule } from './a2a/a2a.module';
import { AgentModule } from './agent/agent.module';
import { BillingModule } from './billing/billing.module';
import { CustomersModule } from './customers/customers.module';
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
    CustomersModule,
    BillingModule,
    AgentModule,
    A2aModule,
  ],
})
export class AppModule {}
