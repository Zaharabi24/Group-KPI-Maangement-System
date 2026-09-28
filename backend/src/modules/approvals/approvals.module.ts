import { Module } from '@nestjs/common';
import { ApprovalsService } from './approvals.service';
import { ApprovalsController } from './approvals.controller';
import { KpiModule } from '../kpi/kpi.module';
import { PerformanceModule } from '../performance/performance.module';

@Module({
  imports: [KpiModule, PerformanceModule],
  controllers: [ApprovalsController],
  providers: [ApprovalsService],
  exports: [ApprovalsService],
})
export class ApprovalsModule {}
