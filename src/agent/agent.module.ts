import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import OpenAI from 'openai';
import type { AppConfig } from '../common/config/configuration';
import { CustomersModule } from '../customers/customers.module';
import { CustomersService } from '../customers/customers.service';
import { AgentController } from './agent.controller';
import { AgentOrchestrator } from './agent.orchestrator';
import { FireworksExtractorAdapter } from './llm/fireworks-extractor.adapter';
import { LlmAuditService } from './llm/llm-audit.service';
import { LLM_CALL_RECORDER, type LlmCallRecorder } from './llm/llm-call-record';
import { LlmCallLog } from './llm/llm-call-log.entity';
import { LLM_EXTRACTOR } from './llm/llm-extractor.port';
import { BILLING_GATEWAY } from './ports/billing-gateway.port';
import { CUSTOMER_LOOKUP } from './ports/customer-lookup.port';
import { pendingBillingGateway } from './ports/pending-integration';

function createFireworksExtractor(
  config: ConfigService,
  recorder: LlmCallRecorder,
): FireworksExtractorAdapter {
  const llm = config.getOrThrow<AppConfig['llm']>('llm');
  const client = new OpenAI({
    apiKey: llm.apiKey,
    baseURL: llm.baseUrl,
    timeout: llm.timeoutMs,
    // Los reintentos los hace el adaptador, con su propia política (sección 9.2).
    maxRetries: 0,
  });
  return new FireworksExtractorAdapter(
    { create: (params) => client.chat.completions.create(params) },
    { model: llm.model, maxTokens: llm.maxTokens },
    recorder,
  );
}

@Module({
  imports: [TypeOrmModule.forFeature([LlmCallLog]), CustomersModule],
  controllers: [AgentController],
  providers: [
    AgentOrchestrator,
    LlmAuditService,
    { provide: LLM_CALL_RECORDER, useExisting: LlmAuditService },
    // Las pruebas reemplazan este token por el MockExtractor.
    {
      provide: LLM_EXTRACTOR,
      inject: [ConfigService, LLM_CALL_RECORDER],
      useFactory: createFireworksExtractor,
    },
    { provide: CUSTOMER_LOOKUP, useExisting: CustomersService },
    // Pendiente: enlazar con los casos de uso de billing (Jheison) cuando existan.
    { provide: BILLING_GATEWAY, useValue: pendingBillingGateway },
  ],
})
export class AgentModule {}
