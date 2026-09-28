import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.module';
import { QueueService } from '../../queue/queue.service';
import { MailerService } from '../../mailer/mailer.service';
import { Public, Permissions, CurrentUser } from '../../common/decorators';
import { AuthUser } from '../../common/interfaces/auth-user.interface';
import { PERM } from '../../common/constants';
import { existsSync } from 'fs';
import { resolve } from 'path';

/**
 * Health and system health. `/health` is public (container liveness probe);
 * `/health/system` exposes queue, storage and mail diagnostics to the Super Admin
 * without ever revealing KPI content (§5.2).
 */
@Controller('health')
export class HealthController {
  private readonly startedAt = Date.now();

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly queue: QueueService,
    private readonly mailer: MailerService,
  ) {}

  @Public()
  @Get()
  async health() {
    const [db, cache] = await Promise.all([this.prisma.ping(), this.redis.ping()]);
    const healthy = db && cache;
    return {
      status: healthy ? 'ok' : 'degraded',
      service: 'anwar-kpi-api',
      version: '1.0.0',
      uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000),
      checks: {
        database: db ? 'up' : 'down',
        redis: cache ? 'up' : 'down',
        api: 'up',
      },
      timestamp: new Date().toISOString(),
    };
  }

  @Get('system')
  @Permissions(PERM.SYSTEM_SETTINGS)
  async system(@CurrentUser() user: AuthUser) {
    const start = Date.now();
    const stats = await this.queue.stats();
    const failures = await Promise.all([
      this.queue.recentFailures('email', 10),
      this.queue.recentFailures('export', 10),
      this.queue.recentFailures('scheduled', 10),
    ]);

    const evidenceDir = resolve(process.env.STORAGE_LOCAL_PATH || './storage/evidence');
    const exportDir = resolve(process.env.EXPORT_LOCAL_PATH || './storage/exports');

    const [userCount, kpiCount, auditCount, emailFailures] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.kpi.count({ where: { status: { not: 'DELETED' } } }),
      this.prisma.auditLog.count(),
      this.prisma.emailLog.count({ where: { status: 'FAILED' } }),
    ]);

    const recentJobs = await this.prisma.scheduledJobRun.findMany({
      orderBy: { startedAt: 'desc' },
      take: 15,
    });

    const smtp = String(process.env.MAIL_ENABLED ?? 'true') === 'true' ? await this.mailer.verify() : false;

    return {
      status: 'ok',
      responseMs: Date.now() - start,
      actor: { id: user.id, fullName: user.fullName, roles: user.roles },
      database: {
        connected: await this.prisma.ping(),
        users: userCount,
        kpis: kpiCount,
        auditRecords: auditCount,
      },
      redis: { connected: await this.redis.ping() },
      queues: stats,
      queueFailures: {
        email: failures[0],
        export: failures[1],
        scheduled: failures[2],
      },
      email: { enabled: String(process.env.MAIL_ENABLED ?? 'true') === 'true', smtpReachable: smtp, failedMessages: emailFailures },
      storage: {
        evidencePath: evidenceDir,
        evidenceWritable: existsSync(evidenceDir),
        exportPath: exportDir,
        exportWritable: existsSync(exportDir),
        encryptionAtRest: String(process.env.EVIDENCE_ENCRYPT_AT_REST ?? 'true') === 'true',
        malwareScan: String(process.env.MALWARE_SCAN_ENABLED ?? 'false') === 'true',
      },
      scheduledJobs: recentJobs.map((j) => ({
        name: j.jobName,
        status: j.status,
        startedAt: j.startedAt,
        endedAt: j.endedAt,
      })),
      environment: {
        nodeEnv: process.env.NODE_ENV,
        timezone: process.env.TIMEZONE ?? 'Asia/Dhaka',
        workingWeek: 'Saturday–Thursday (Friday is the weekly holiday)',
        allowedEmailDomain: process.env.ALLOWED_EMAIL_DOMAIN ?? 'anwargroup.net',
      },
    };
  }
}
