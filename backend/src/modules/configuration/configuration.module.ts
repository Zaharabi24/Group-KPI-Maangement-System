import { Module } from '@nestjs/common';
import { ConfigurationController } from './configuration.controller';
import { ConfigurationService } from './configuration.service';

/**
 * FR-CFG-02 / §4.9 — versioned configuration and open-period recalculation.
 * PrismaService and AuditService are app-global providers.
 */
@Module({
  controllers: [ConfigurationController],
  providers: [ConfigurationService],
  exports: [ConfigurationService],
})
export class ConfigurationModule {}
