import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { ExportRunnerService } from './export-runner.service';
import { ExportJobPayload } from '../queue.service';
import { QUEUE } from '../../common/constants';

/** Async export worker — FR-RPT-02: exports over 10,000 rows run in the queue. */
@Processor(QUEUE.EXPORT, { concurrency: 2 })
export class ExportProcessor extends WorkerHost {
  private readonly logger = new Logger(ExportProcessor.name);

  constructor(private readonly runner: ExportRunnerService) {
    super();
  }

  async process(job: Job<ExportJobPayload>): Promise<unknown> {
    this.logger.log(`Generating export job ${job.data.exportJobId}`);
    return this.runner.run(job.data.exportJobId);
  }
}
