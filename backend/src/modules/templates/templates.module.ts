import { Module } from '@nestjs/common';
import { TemplatesController } from './templates.controller';
import { TemplatesService } from './templates.service';

/**
 * M04 — KPI library (templates, categories, assignments). PrismaService,
 * AuditService and NotificationsService are app-global providers.
 */
@Module({
  controllers: [TemplatesController],
  providers: [TemplatesService],
  exports: [TemplatesService],
})
export class TemplatesModule {}
