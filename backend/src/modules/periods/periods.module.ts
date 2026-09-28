import { Module } from '@nestjs/common';
import { PeriodsController, PeriodsSelectableController } from './periods.controller';
import { PeriodsService } from './periods.service';
import { PerformanceModule } from '../performance/performance.module';

/**
 * M03 / FR-CFG-01/03/04 — period calendar, close/reopen workflow and extensions.
 * AuditService, NotificationsService and QueueService are app-global providers.
 */
@Module({
  imports: [PerformanceModule],
  controllers: [PeriodsController, PeriodsSelectableController],
  providers: [PeriodsService],
  exports: [PeriodsService],
})
export class PeriodsModule {}
