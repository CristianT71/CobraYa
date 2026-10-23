import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BillingModule } from '../billing/billing.module';
import { Invoice } from '../billing/entities/invoice.entity';
import type { AppConfig } from '../common/config/configuration';
import { CustomersModule } from '../customers/customers.module';
import { CustomersService } from '../customers/customers.service';
import { AgentController } from './agent.controller';
import { AgentOrchestrator } from './agent.orchestrator';
import { createFireworksExtractor } from './llm/fireworks-extractor.adapter';
import { LlmAuditService } from './llm/llm-audit.service';
import { LLM_CALL_RECORDER, type LlmCallRecorder } from './llm/llm-call-record';
import { LlmCallLog } from './llm/llm-call-log.entity';
import { LLM_EXTRACTOR } from './llm/llm-extractor.port';
import { BILLING_GATEWAY } from './ports/billing-gateway.port';
import { CUSTOMER_LOOKUP } from './ports/customer-lookup.port';
import { BillingUseCasesGateway } from './ports/billing-use-cases.gateway';

@Module({
  imports: [
    TypeOrmModule.forFeature([LlmCallLog, Invoice]),
    CustomersModule,
    BillingModule,
  ],
  controllers: [AgentController],
  providers: [
    AgentOrchestrator,
    LlmAuditService,
    { provide: LLM_CALL_RECORDER, useExisting: LlmAuditService },
    // Las pruebas reemplazan este token por el MockExtractor.
    {
      provide: LLM_EXTRACTOR,
      inject: [ConfigService, LLM_CALL_RECORDER],
      useFactory: (config: ConfigService, recorder: LlmCallRecorder) =>
        createFireworksExtractor(
          config.getOrThrow<AppConfig['llm']>('llm'),
          recorder,
        ),
    },
    { provide: CUSTOMER_LOOKUP, useExisting: CustomersService },
    BillingUseCasesGateway,
    { provide: BILLING_GATEWAY, useExisting: BillingUseCasesGateway },
  ],
})
export class AgentModule {}
