import { Module } from '@nestjs/common';
import { KpiService } from './kpi.service';
import { KpiController } from './kpi.controller';
import { EvidenceStorageService } from '../evidence/evidence-storage.service';
import { PerformanceModule } from '../performance/performance.module';

@Module({
  imports: [PerformanceModule],
  controllers: [KpiController],
  providers: [KpiService, EvidenceStorageService],
  exports: [KpiService, EvidenceStorageService],
})
export class KpiModule {}
