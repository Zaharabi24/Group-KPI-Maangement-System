/**
 * Business error catalogue — BRD §13.3.
 * Every error thrown by a domain service is a BusinessException so the global
 * filter can render the standard envelope:
 *   { "error": { "code", "message", "field_errors": [...], "correlation_id" } }
 */
import { HttpException, HttpStatus } from '@nestjs/common';

export const ErrorCode = {
  // Validation
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  V_TGT_01: 'V-TGT-01',
  V_NUM_02: 'V-NUM-02',
  V_TEXT_01: 'V-TEXT-01',
  V_EMAIL_01: 'V-EMAIL-01',
  V_PHONE_01: 'V-PHONE-01',
  V_PASSWORD_01: 'V-PASSWORD-01',
  V_MISSING: 'V-MISSING',

  // Weights & capacity
  W_EXCEED: 'W-EXCEED',
  W_MIN: 'W-MIN',
  W_MAX: 'W-MAX',
  MAX_KPI: 'MAX-KPI',

  // KPI
  KPI_DUP: 'KPI-DUP',
  KPI_NOT_FOUND: 'KPI-NOT-FOUND',
  KPI_LOCKED: 'KPI-LOCKED',
  KPI_STATUS: 'KPI-STATUS',
  PERIOD_CLOSED: 'PERIOD-CLOSED',
  DEADLINE_PASSED: 'DEADLINE-PASSED',
  APPROVER_INVALID: 'APPROVER-INVALID',
  APPROVER_REQUIRED: 'APPROVER-REQUIRED',
  SELF_DECISION: 'SELF-DECISION',
  STALE_VERSION: 'STALE-VERSION',
  REASON_REQUIRED: 'REASON-REQUIRED',
  EVIDENCE_REQUIRED: 'EVIDENCE-REQUIRED',
  FILE_REJECTED: 'FILE-REJECTED',
  ESCALATION_EXISTS: 'ESCALATION-EXISTS',
  NOT_ESCALATED: 'NOT-ESCALATED',
  CORRECTION_REQUIRED: 'CORRECTION-REQUIRED',
  PERIOD_PENDING_ITEMS: 'PERIOD-PENDING-ITEMS',
  PERIOD_ALREADY_CLOSED: 'PERIOD-ALREADY-CLOSED',
  PERIOD_NOT_CLOSED: 'PERIOD-NOT-CLOSED',

  // Auth
  AUTH_INVALID_CREDENTIALS: 'AUTH-INVALID-CREDENTIALS',
  AUTH_ACCOUNT_LOCKED: 'AUTH-ACCOUNT-LOCKED',
  AUTH_ACCOUNT_INACTIVE: 'AUTH-ACCOUNT-INACTIVE',
  AUTH_TOKEN_INVALID: 'AUTH-TOKEN-INVALID',
  AUTH_TOKEN_EXPIRED: 'AUTH-TOKEN-EXPIRED',
  AUTH_UNAUTHENTICATED: 'AUTH-UNAUTHENTICATED',
  AUTH_DUPLICATE: 'AUTH-DUPLICATE',
  AUTH_LAST_APPROVER: 'AUTH-LAST-APPROVER',
  AUTH_RESET_REQUIRED: 'AUTH-RESET-REQUIRED',

  // Authorisation
  FORBIDDEN: 'FORBIDDEN',
  OUT_OF_SCOPE: 'OUT-OF-SCOPE',
  HR_ROLE_ESCALATION: 'HR-ROLE-ESCALATION',

  // Not found / conflict
  NOT_FOUND: 'NOT-FOUND',
  CONFLICT: 'CONFLICT',
  RATE_LIMITED: 'RATE-LIMITED',
  INTERNAL: 'INTERNAL-ERROR',
} as const;

export type ErrorCodeKey = (typeof ErrorCode)[keyof typeof ErrorCode];

export interface FieldError {
  field: string;
  code: string;
  message: string;
}

export class BusinessException extends HttpException {
  readonly code: string;
  readonly fieldErrors: FieldError[];

  constructor(code: string, message: string, status: HttpStatus = HttpStatus.CONFLICT, fieldErrors: FieldError[] = []) {
    super({ code, message, fieldErrors }, status);
    this.code = code;
    this.fieldErrors = fieldErrors;
  }
}

export const BadRequest = (code: string, message: string, fieldErrors?: FieldError[]) =>
  new BusinessException(code, message, HttpStatus.BAD_REQUEST, fieldErrors);

export const Unprocessable = (code: string, message: string, fieldErrors?: FieldError[]) =>
  new BusinessException(code, message, HttpStatus.UNPROCESSABLE_ENTITY, fieldErrors);

export const Conflict = (code: string, message: string, fieldErrors?: FieldError[]) =>
  new BusinessException(code, message, HttpStatus.CONFLICT, fieldErrors);

export const Forbidden = (code: string, message: string) =>
  new BusinessException(code, message, HttpStatus.FORBIDDEN);

export const NotFound = (code: string, message: string) =>
  new BusinessException(code, message, HttpStatus.NOT_FOUND);

export const Unauthorized = (code: string, message: string) =>
  new BusinessException(code, message, HttpStatus.UNAUTHORIZED);

/** UI copy for the weight-capacity rule W-2 / W-EXCEED. */
export const weightExceededMessage = (overBy: number, available: number): string =>
  `Weight exceeds 100% by ${overBy.toFixed(2)}%. Available: ${available.toFixed(0)}%`;
