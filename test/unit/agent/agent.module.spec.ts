import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AgentController } from '../../../src/agent/agent.controller';
import { AgentModule } from '../../../src/agent/agent.module';
import { FireworksExtractorAdapter } from '../../../src/agent/llm/fireworks-extractor.adapter';
import { LlmAuditService } from '../../../src/agent/llm/llm-audit.service';
import { LLM_CALL_RECORDER } from '../../../src/agent/llm/llm-call-record';
import { LlmCallLog } from '../../../src/agent/llm/llm-call-log.entity';
import { LLM_EXTRACTOR } from '../../../src/agent/llm/llm-extractor.port';
import { BillingUseCasesGateway } from '../../../src/agent/ports/billing-use-cases.gateway';
import { BILLING_GATEWAY } from '../../../src/agent/ports/billing-gateway.port';
import { CUSTOMER_LOOKUP } from '../../../src/agent/ports/customer-lookup.port';
import { InvoiceItem } from '../../../src/billing/entities/invoice-item.entity';
import { Invoice } from '../../../src/billing/entities/invoice.entity';
import { Payment } from '../../../src/billing/entities/payment.entity';
import { Receipt } from '../../../src/billing/entities/receipt.entity';
import configuration from '../../../src/common/config/configuration';
import { Customer } from '../../../src/customers/customer.entity';
import { CustomersService } from '../../../src/customers/customers.service';

// Sustituye la conexión a PostgreSQL que en la aplicación real pone TypeOrmModule.forRoot.
@Global()
@Module({
  providers: [{ provide: DataSource, useValue: {} }],
  exports: [DataSource],
})
class FakeDatabaseModule {}

// Comprueba que AgentModule resuelve todas sus dependencias (incluidos los casos
// de uso de billing). Los repositorios se reemplazan para no necesitar PostgreSQL.
describe('AgentModule', () => {
  it('registra el controlador, el adaptador de Fireworks y la bitácora', async () => {
    Object.assign(process.env, {
      FIREWORKS_API_KEY: 'fw-prueba',
      FIREWORKS_BASE_URL: 'https://api.fireworks.ai/inference/v1',
      FIREWORKS_MODEL: 'accounts/fireworks/models/gpt-oss-120b',
    });

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [configuration],
        }),
        FakeDatabaseModule,
        AgentModule,
      ],
    })
      .overrideProvider(getRepositoryToken(LlmCallLog))
      .useValue({ insert: jest.fn() })
      .overrideProvider(getRepositoryToken(Customer))
      .useValue({ find: jest.fn() })
      .overrideProvider(getRepositoryToken(Invoice))
      .useValue({ find: jest.fn() })
      .overrideProvider(getRepositoryToken(InvoiceItem))
      .useValue({})
      .overrideProvider(getRepositoryToken(Payment))
      .useValue({})
      .overrideProvider(getRepositoryToken(Receipt))
      .useValue({})
      .compile();

    expect(moduleRef.get(AgentController)).toBeInstanceOf(AgentController);
    expect(moduleRef.get(LLM_EXTRACTOR)).toBeInstanceOf(
      FireworksExtractorAdapter,
    );
    expect(moduleRef.get(LLM_CALL_RECORDER)).toBe(
      moduleRef.get(LlmAuditService),
    );
    expect(moduleRef.get(CUSTOMER_LOOKUP)).toBe(
      moduleRef.get(CustomersService),
    );
    expect(moduleRef.get(BILLING_GATEWAY)).toBeInstanceOf(
      BillingUseCasesGateway,
    );
    await moduleRef.close();
  });
});
