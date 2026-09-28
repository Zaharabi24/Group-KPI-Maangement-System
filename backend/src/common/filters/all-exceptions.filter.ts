import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { BusinessException, ErrorCode, FieldError } from '../errors/error-codes';

/**
 * Global exception filter — BRD §13.3.
 * Renders the standard envelope and never leaks stack traces or internal
 * identifiers (NFR-ERR-01).
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const correlationId =
      (request as unknown as { correlationId?: string }).correlationId ||
      (request.headers['x-correlation-id'] as string | undefined) ||
      undefined;

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code: string = ErrorCode.INTERNAL;
    let message = 'Something went wrong. Please retry; if it persists quote the reference ID.';
    let fieldErrors: FieldError[] = [];

    if (exception instanceof BusinessException) {
      status = exception.getStatus();
      code = exception.code;
      message = exception.message;
      fieldErrors = exception.fieldErrors;
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse() as
        | string
        | { message?: string | string[]; error?: string; code?: string };
      if (typeof body === 'string') {
        message = body;
        code = mapStatusToCode(status);
      } else if (body && typeof body === 'object') {
        code = body.code || mapStatusToCode(status);
        const raw = body.message;
        if (Array.isArray(raw)) {
          message = raw[0] ?? message;
          fieldErrors = raw.map((m) => {
            const [field, ...rest] = String(m).split(' ');
            return { field, code: 'VALIDATION', message: String(m) };
          });
        } else if (typeof raw === 'string') {
          message = raw;
        }
      }
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      const mapped = mapPrismaError(exception);
      status = mapped.status;
      code = mapped.code;
      message = mapped.message;
    } else if (exception instanceof Prisma.PrismaClientValidationError) {
      status = HttpStatus.BAD_REQUEST;
      code = ErrorCode.VALIDATION_FAILED;
      message = 'The request payload is not valid for this operation.';
    } else if (exception instanceof Error) {
      this.logger.error(
        `[${correlationId ?? '-'}] ${exception.message}`,
        exception.stack,
      );
    }

    if (status >= 500) {
      this.logger.error(`[${correlationId ?? '-'}] ${request.method} ${request.url} → ${status} ${code}`);
    }

    response.status(status).json({
      error: {
        code,
        message,
        field_errors: fieldErrors,
        correlation_id: correlationId ?? null,
        path: request.url,
        timestamp: new Date().toISOString(),
      },
    });
  }
}

const mapStatusToCode = (status: number): string => {
  switch (status) {
    case HttpStatus.BAD_REQUEST:
      return ErrorCode.VALIDATION_FAILED;
    case HttpStatus.UNAUTHORIZED:
      return ErrorCode.AUTH_UNAUTHENTICATED;
    case HttpStatus.FORBIDDEN:
      return ErrorCode.FORBIDDEN;
    case HttpStatus.NOT_FOUND:
      return ErrorCode.NOT_FOUND;
    case HttpStatus.CONFLICT:
      return ErrorCode.CONFLICT;
    case HttpStatus.TOO_MANY_REQUESTS:
      return ErrorCode.RATE_LIMITED;
    default:
      return ErrorCode.INTERNAL;
  }
};

const mapPrismaError = (
  e: Prisma.PrismaClientKnownRequestError,
): { status: number; code: string; message: string } => {
  switch (e.code) {
    case 'P2002': {
      const target = (e.meta?.target as string[] | string | undefined) ?? 'value';
      const fields = Array.isArray(target) ? target.join(', ') : String(target);
      return {
        status: HttpStatus.CONFLICT,
        code: ErrorCode.CONFLICT,
        message: `A record with this ${fields} already exists.`,
      };
    }
    case 'P2003':
      return {
        status: HttpStatus.CONFLICT,
        code: ErrorCode.CONFLICT,
        message: 'This record is referenced by other data and cannot be removed.',
      };
    case 'P2025':
      return {
        status: HttpStatus.NOT_FOUND,
        code: ErrorCode.NOT_FOUND,
        message: 'The requested record was not found.',
      };
    case 'P2034':
      return {
        status: HttpStatus.CONFLICT,
        code: ErrorCode.STALE_VERSION,
        message: 'The record changed while you were working. Reload to continue.',
      };
    default:
      return {
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        code: ErrorCode.INTERNAL,
        message: 'A data store error occurred. Please quote the reference ID to IT.',
      };
  }
};
