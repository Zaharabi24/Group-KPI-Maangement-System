import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { QUEUE } from '../common/constants';

export interface EmailJobPayload {
  emailLogId: string;
  to: string;
  cc?: string;
  templateCode: string;
  context: Record<string, unknown>;
  subjectOverride?: string;
  attempt?: number;
}

export interface ExportJobPayload {
  exportJobId: string;
}

export interface ScheduledJobPayload {
  name:
    | 'deadline-reminders'
    | 'sla-check'
    | 'nightly-verification'
    | 'period-snapshot'
    | 'hash-chain-verify'
    | 'digest-emails'
    | 'overdue-sweep'
    | 'purge-expired';
  detail?: Record<string, unknown>;
}

/** Friendly job names so the queue dashboard is readable. */
const NICE: Record<string, string> = {
  'deadline-reminders': 'Deadline reminders (NT-13/NT-14)',
  'sla-check': 'Review SLA check (NT-15)',
  'nightly-verification': 'Nightly calculation verification (FR-CAL-04)',
  'period-snapshot': 'Period snapshot generation',
  'hash-chain-verify': 'Audit hash-chain verification (§18)',
  'digest-emails': 'Daily digest e-mails (FR-PRF-05)',
  'overdue-sweep': 'Overdue KPI sweep (EC-09)',
  'purge-expired': 'Purge expired tokens and exports',
};

@Injectable()
export class QueueService implements OnModuleInit {
  private readonly logger = new Logger(QueueService.name);

  constructor(
    @InjectQueue(QUEUE.EMAIL) private readonly emailQueue: Queue,
    @InjectQueue(QUEUE.EXPORT) private readonly exportQueue: Queue,
    @InjectQueue(QUEUE.SCHEDULED) private readonly scheduledQueue: Queue,
  ) {}

  async onModuleInit(): Promise<void> {
    // Repeatable (cron) jobs — §15 and §4.9.
    const repeatables: Array<{ name: ScheduledJobPayload['name']; pattern: string }> = [
      { name: 'deadline-reminders', pattern: '0 8 * * *' }, // daily 08:00 Asia/Dhaka
      { name: 'overdue-sweep', pattern: '5 0 * * *' }, // daily 00:05
      { name: 'sla-check', pattern: '30 8 * * *' },
      { name: 'nightly-verification', pattern: '0 2 * * *' },
      { name: 'hash-chain-verify', pattern: '0 3 * * 0' }, // weekly, Sunday 03:00
      { name: 'digest-emails', pattern: '0 7 * * *' },
      { name: 'purge-expired', pattern: '15 3 * * *' },
    ];

    try {
      for (const r of repeatables) {
        await this.scheduledQueue.add(
          r.name,
          { name: r.name } satisfies ScheduledJobPayload,
          {
            repeat: { pattern: r.pattern },
            jobId: `repeat:${r.name}`,
            removeOnComplete: true,
            removeOnFail: 50,
          },
        );
      }
      this.logger.log(`Registered ${repeatables.length} scheduled jobs: ${repeatables.map((r) => NICE[r.name]).join(' · ')}`);
    } catch (e) {
      this.logger.warn(`Could not register repeatable jobs: ${(e as Error).message}`);
    }
  }

  /** Enqueues an e-mail with the 1 / 5 / 15 minute retry ladder (NFR-REL-01). */
  async enqueueEmail(payload: EmailJobPayload): Promise<Job | null> {
    try {
      return await this.emailQueue.add('send', payload, {
        attempts: 3,
        backoff: { type: 'custom' },
        removeOnComplete: { age: 24 * 3600, count: 2000 },
        removeOnFail: { age: 7 * 24 * 3600 },
      });
    } catch (e) {
      this.logger.error(`Failed to enqueue e-mail to ${payload.to}: ${(e as Error).message}`);
      return null;
    }
  }

  async enqueueExport(payload: ExportJobPayload): Promise<Job | null> {
    try {
      return await this.exportQueue.add('generate', payload, {
        attempts: 2,
        backoff: { type: 'exponential', delay: 5000 },
      });
    } catch (e) {
      this.logger.error(`Failed to enqueue export: ${(e as Error).message}`);
      return null;
    }
  }

  async enqueueScheduled(
    payload: ScheduledJobPayload,
    delayMs = 0,
  ): Promise<Job | null> {
    try {
      return await this.scheduledQueue.add(payload.name, payload, { delay: delayMs, attempts: 1 });
    } catch (e) {
      this.logger.error(`Failed to enqueue scheduled job ${payload.name}: ${(e as Error).message}`);
      return null;
    }
  }

  /** Queue health for /health and the System Health screen. */
  async stats() {
    const [email, exportQueue, scheduled] = await Promise.all([
      this.counts(this.emailQueue),
      this.counts(this.exportQueue),
      this.counts(this.scheduledQueue),
    ]);
    return { email, export: exportQueue, scheduled };
  }

  private async counts(queue: Queue) {
    try {
      const [waiting, active, completed, failed, delayed] = await Promise.all([
        queue.getWaitingCount(),
        queue.getActiveCount(),
        queue.getCompletedCount(),
        queue.getFailedCount(),
        queue.getDelayedCount(),
      ]);
      return { name: queue.name, waiting, active, completed, failed, delayed, backlog: waiting + delayed };
    } catch {
      return { name: queue.name, waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0, backlog: 0 };
    }
  }

  /** Recent failures for the System Health screen (no KPI content). */
  async recentFailures(queueName: string, limit = 20) {
    const queue =
      queueName === QUEUE.EMAIL ? this.emailQueue : queueName === QUEUE.EXPORT ? this.exportQueue : this.scheduledQueue;
    const jobs = await queue.getFailed(0, limit - 1);
    return jobs.map((j) => ({
      id: j.id,
      name: j.name,
      failedReason: j.failedReason,
      attemptsMade: j.attemptsMade,
      timestamp: j.timestamp ? new Date(j.timestamp).toISOString() : null,
    }));
  }
}
