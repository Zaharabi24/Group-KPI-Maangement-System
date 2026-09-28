import { Module } from '@nestjs/common';
import { PerformanceService } from './performance.service';

/**
 * Performance aggregates / snapshots module — imported by PeriodsModule so the
 * close workflow can call `generateSnapshots`. PrismaService and ScopeService
 * are provided globally by the app root.
 */
@Module({
  providers: [PerformanceService],
  exports: [PerformanceService],
})
export class PerformanceModule {}
