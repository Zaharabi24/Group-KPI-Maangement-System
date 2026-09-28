import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';

import { PrismaModule } from './common/prisma/prisma.module';
import { RedisModule } from './common/redis/redis.module';
import { ScopeModule } from './common/scope/scope.module';
import { MailerModule } from './mailer/mailer.module';
import { QueueModule } from './queue/queue.module';
import { ScopeService } from './common/scope/scope.service';
import { CorrelationIdMiddleware } from './common/middleware/correlation-id.middleware';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { JwtAuthGuard, PermissionsGuard, RolesGuard } from './common/decorators';

import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { OrganisationModule } from './modules/organisation/organisation.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { PerformanceModule } from './modules/performance/performance.module';
import { PeriodsModule } from './modules/periods/periods.module';
import { ConfigurationModule } from './modules/configuration/configuration.module';
import { TemplatesModule } from './modules/templates/templates.module';
import { KpiModule } from './modules/kpi/kpi.module';
import { ApprovalsModule } from './modules/approvals/approvals.module';
import { DashboardsModule } from './modules/dashboards/dashboards.module';
import { ReportsModule } from './modules/reports/reports.module';
import { PlatformModule } from './modules/platform/platform.module';

/**
 * ANWAR KPIFlow — application composition root.
 * Layer order: infrastructure → cross-cutting → domain modules (§12.3).
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['.env.local', '.env'] }),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([
      {
        name: 'default',
        ttl: 60_000,
        limit: Number(process.env.RATE_LIMIT_API_PER_MIN ?? 300),
      },
    ]),

    // Infrastructure
    PrismaModule,
    RedisModule,
    ScopeModule,
    MailerModule,
    QueueModule,

    // Cross-cutting
    AuditModule,
    NotificationsModule,
    PerformanceModule,

    // Identity & organisation
    AuthModule,
    UsersModule,
    OrganisationModule,

    // KPI domain
    KpiModule,
    ApprovalsModule,
    PeriodsModule,
    ConfigurationModule,
    TemplatesModule,
    DashboardsModule,
    ReportsModule,
    PlatformModule,
  ],
  providers: [
    ScopeService,
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: TransformInterceptor },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
  exports: [ScopeService],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(CorrelationIdMiddleware)
      .forRoutes({ path: '*', method: RequestMethod.ALL });
  }
}
