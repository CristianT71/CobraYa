import { Module } from '@nestjs/common';
import { AgentModule } from '../agent/agent.module';
import { BillingModule } from '../billing/billing.module';
import { CustomersModule } from '../customers/customers.module';
import { PartnersModule } from '../partners/partners.module';
import { ReceiptsModule } from '../receipts/receipts.module';
import { A2aTasksController, AgentCardController } from './a2a.controller';
import { ExchangeAuditService } from './exchange-audit.service';
import { PartnerAuthGuard } from './partner-auth.guard';
import { TasksService } from './tasks.service';

// Canal para que otros negocios (concesionario, taller, repuestos...) usen
// Facturación y Pagos con su propia key: tarjeta pública del bot y tareas.
@Module({
  imports: [
    PartnersModule,
    CustomersModule,
    BillingModule,
    AgentModule,
    ReceiptsModule,
  ],
  controllers: [AgentCardController, A2aTasksController],
  providers: [TasksService, ExchangeAuditService, PartnerAuthGuard],
  exports: [ExchangeAuditService],
})
export class A2aModule {}
