import { Module } from '@nestjs/common';
import { A2aModule } from '../a2a/a2a.module';
import { PartnersModule } from '../partners/partners.module';
import { AdminPartnersController } from './admin-partners.controller';

@Module({
  imports: [PartnersModule, A2aModule],
  controllers: [AdminPartnersController],
})
export class AdminModule {}
