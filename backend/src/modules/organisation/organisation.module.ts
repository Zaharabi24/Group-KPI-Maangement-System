import { Module } from '@nestjs/common';
import { OrganisationController } from './organisation.controller';
import { OrganisationService } from './organisation.service';
import { AuditService } from '../audit/audit.service';

/**
 * Organisation master data (FR-ORG-01). PrismaService comes from the global
 * PrismaModule; AuditService is provided here as well so the module is
 * self-contained regardless of how the audit module is registered.
 */
@Module({
  controllers: [OrganisationController],
  providers: [OrganisationService, AuditService],
  exports: [OrganisationService],
})
export class OrganisationModule {}
