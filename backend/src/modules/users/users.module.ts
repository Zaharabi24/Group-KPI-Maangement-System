import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { ScopeService } from '../../common/scope/scope.service';
import { AuditService } from '../audit/audit.service';

/**
 * Users & access administration (FR-PRF-01..05, FR-ORG-02..09).
 * PrismaService comes from the global PrismaModule; ScopeService and AuditService
 * are provided locally so the module is self-contained.
 */
@Module({
  controllers: [UsersController],
  providers: [UsersService, ScopeService, AuditService],
  exports: [UsersService, ScopeService],
})
export class UsersModule {}
