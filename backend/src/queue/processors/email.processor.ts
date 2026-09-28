import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { MailerService } from '../../mailer/mailer.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { EmailJobPayload } from '../queue.service';
import { QUEUE } from '../../common/constants';

/** Retry ladder 1 / 5 / 15 minutes (NFR-REL-01). */
const BACKOFF_MS = [60_000, 5 * 60_000, 15 * 60_000];

/**
 * E-mail worker — Figure 13. Three attempts with the 1/5/15 minute ladder; the
 * outcome is written to `email_log` so failed deliveries can be monitored.
 */
@Processor(QUEUE.EMAIL, { concurrency: 5 })
export class EmailProcessor extends WorkerHost {
  private readonly logger = new Logger(EmailProcessor.name);

  constructor(
    private readonly mailer: MailerService,
    private readonly prisma: PrismaService,
  ) {
    super();
  }

  async process(job: Job<EmailJobPayload>): Promise<unknown> {
    const payload = job.data;
    const attempt = job.attemptsMade;
    this.logger.debug(`Sending ${payload.templateCode} to ${payload.to} (attempt ${attempt + 1})`);

    await this.prisma.emailLog.update({
      where: { id: payload.emailLogId },
      data: { status: 'RETRYING', attempts: attempt + 1 },
    });

    try {
      const { messageId } = await this.mailer.send({
        to: payload.to,
        cc: payload.cc,
        templateCode: payload.templateCode,
        context: payload.context,
        subjectOverride: payload.subjectOverride,
      });

      await this.prisma.emailLog.update({
        where: { id: payload.emailLogId },
        data: {
          status: 'SENT',
          messageId,
          sentAt: new Date(),
          attempts: attempt + 1,
          lastError: null,
        },
      });

      return { messageId };
    } catch (error) {
      const message = (error as Error).message ?? 'Unknown SMTP error';
      await this.prisma.emailLog.update({
        where: { id: payload.emailLogId },
        data: { status: 'FAILED', lastError: message.slice(0, 990), attempts: attempt + 1 },
      });
      throw error;
    }
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<EmailJobPayload>, error: Error): void {
    const attempts = job.opts.attempts ?? 3;
    if (job.attemptsMade >= attempts) {
      this.logger.error(
        `E-mail permanently failed after ${job.attemptsMade} attempts → ${job.data.to} (${job.data.templateCode}): ${error.message}`,
      );
    }
  }

  /** Custom backoff consumed by BullMQ. */
  static backoffStrategy(attemptsMade: number): number {
    return BACKOFF_MS[Math.min(attemptsMade, BACKOFF_MS.length - 1)];
  }
}
