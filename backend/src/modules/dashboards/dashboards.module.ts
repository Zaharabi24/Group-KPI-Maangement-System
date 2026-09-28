import { Module } from '@nestjs/common';
import { DashboardsService } from './dashboards.service';
import { DashboardsController, LeaderboardController } from './dashboards.controller';
import { PerformanceModule } from '../performance/performance.module';

@Module({
  imports: [PerformanceModule],
  controllers: [DashboardsController, LeaderboardController],
  providers: [DashboardsService],
  exports: [DashboardsService],
})
export class DashboardsModule {}
