import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'crypto';

/**
 * Correlation IDs — every request gets one, echoed in the response header and
 * written to the logs and the audit trail (NFR-LOG-01, §18).
 */
@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const incoming = (req.headers['x-correlation-id'] as string | undefined)?.slice(0, 64);
    const correlationId = incoming && incoming.length > 0 ? incoming : randomUUID();
    (req as Request & { correlationId?: string }).correlationId = correlationId;
    res.setHeader('x-correlation-id', correlationId);
    next();
  }
}
