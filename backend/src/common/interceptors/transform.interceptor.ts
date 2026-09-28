import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { randomUUID } from 'crypto';
import { Request, Response } from 'express';

/**
 * Wraps every successful response in the standard envelope and attaches the
 * correlation ID so an error can be traced (NFR-LOG-01).
 */
@Injectable()
export class TransformInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const response = http.getResponse<Response>();
    const request = http.getRequest<Request & { correlationId?: string }>();
    const correlationId = request.correlationId || randomUUID();
    response.setHeader('x-correlation-id', correlationId);

    return next.handle().pipe(
      map((data) => {
        // Already enveloped or a streamed file — pass through untouched.
        if (
          data &&
          typeof data === 'object' &&
          ('stream' in (data as object) || 'pipe' in (data as object))
        ) {
          return data;
        }
        return { data, meta: { correlation_id: correlationId, timestamp: new Date().toISOString() } };
      }),
    );
  }
}
