import { Module } from '@nestjs/common';
import { SearchController } from '../search/search.controller';
import { HealthController } from '../health/health.controller';
import { KpiModule } from '../kpi/kpi.module';

/** Lightweight controllers that do not need their own domain services. */
@Module({
  imports: [KpiModule],
  controllers: [SearchController, HealthController],
})
export class PlatformModule {}

