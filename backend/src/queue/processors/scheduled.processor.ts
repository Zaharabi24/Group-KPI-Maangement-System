import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { ScheduledJobsService } from './scheduled-jobs.service';
import { ScheduledJobPayload } from '../queue.service';
import { QUEUE } from '../../common/constants';

/**
 * Scheduled-job worker — deadlines (NT-13/NT-14), SLA checks (NT-15), nightly
 * calculation verification (FR-CAL-04), audit hash-chain verification (§18),
 * digests and retention.
 */
@Processor(QUEUE.SCHEDULED, { concurrency: 2 })
export class ScheduledProcessor extends WorkerHost {
  private readonly logger = new Logger(ScheduledProcessor.name);

  constructor(private readonly jobs: ScheduledJobsService) {
    super();
  }

  async process(job: Job<ScheduledJobPayload>): Promise<unknown> {
    this.logger.log(`Running scheduled job: ${job.name}`);
    return this.jobs.run(job.data.name ?? job.name, job.data.detail);
  }
}
