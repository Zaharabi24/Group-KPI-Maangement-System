import { BullModule } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';
import { QUEUE } from '../common/constants';
import { ReportsModule } from '../modules/reports/reports.module';
import { PerformanceModule } from '../modules/performance/performance.module';
import { EmailProcessor } from './processors/email.processor';
import { ExportProcessor } from './processors/export.processor';
import { ScheduledProcessor } from './processors/scheduled.processor';
import { ExportRunnerService } from './processors/export-runner.service';
import { ScheduledJobsService } from './processors/scheduled-jobs.service';
import { QueueService } from './queue.service';

const connection = {
  host: process.env.REDIS_HOST || 'localhost',
  port: Number(process.env.REDIS_PORT || 6379),
  password: process.env.REDIS_PASSWORD || undefined,
  db: Number(process.env.REDIS_DB || 0),
};

/**
 * Queue infrastructure — Redis + BullMQ (BRD §12.1, Figure 13).
 * Three queues: `email` (NT-01…NT-19 with 3 retries), `export` (async report
 * generation) and `scheduled` (deadline reminders, SLA checks, nightly
 * calculation verification and period snapshots).
 */
@Global()
@Module({
  imports: [
    BullModule.forRoot({
      connection,
      prefix: process.env.QUEUE_PREFIX || 'anwar-kpi',
      defaultJobOptions: {
        removeOnComplete: { age: 24 * 3600, count: 1000 },
        removeOnFail: { age: 7 * 24 * 3600 },
      },
    }),
    BullModule.registerQueue(
      { name: QUEUE.EMAIL },
      { name: QUEUE.EXPORT },
      { name: QUEUE.SCHEDULED },
    ),
    ReportsModule,
    PerformanceModule,
  ],
  providers: [
    QueueService,
    EmailProcessor,
    ExportProcessor,
    ExportRunnerService,
    ScheduledProcessor,
    ScheduledJobsService,
  ],
  exports: [BullModule, QueueService],
})
export class QueueModule {}
