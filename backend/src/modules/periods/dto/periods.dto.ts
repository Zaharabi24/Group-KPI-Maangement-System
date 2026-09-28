import {
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { Frequency, PeriodStatus } from '@prisma/client';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/** GET /admin/periods — period picker list (any role with a dashboard view). */
export class ListPeriodsQueryDto {
  @IsOptional()
  @IsEnum(Frequency)
  frequency?: Frequency;

  @IsOptional()
  @IsString()
  year?: string;

  @IsOptional()
  @IsEnum(PeriodStatus)
  status?: PeriodStatus;

  @IsOptional()
  @IsString()
  page?: string;

  @IsOptional()
  @IsString()
  size?: string;
}

/** POST /admin/periods/calendar — FR-CFG-01 calendar generation. */
export class EnsureCalendarDto {
  @IsInt()
  @Min(2000)
  @Max(2100)
  year!: number;

  @IsOptional()
  @IsArray()
  @IsEnum(Frequency, { each: true })
  frequencies?: Frequency[];
}

/** POST /admin/periods and PATCH /admin/periods/:id — manual period maintenance. */
export class UpsertPeriodDto {
  @IsOptional()
  @IsEnum(Frequency)
  frequency?: Frequency;

  @IsOptional()
  @IsString()
  @Length(1, 24)
  @Transform(trim)
  code?: string;

  @IsOptional()
  @IsString()
  @Length(1, 64)
  @Transform(trim)
  label?: string;

  @IsOptional()
  @IsInt()
  @Min(2000)
  @Max(2100)
  year?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(12)
  periodIndex?: number;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsDateString()
  submissionDeadline?: string;

  @IsOptional()
  @IsDateString()
  reviewDeadline?: string;

  @IsOptional()
  @IsEnum(PeriodStatus)
  status?: PeriodStatus;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

/** POST /admin/periods/:id/close — FR-CFG-03. */
export class ClosePeriodDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;
}

/** POST /admin/periods/:id/reopen — FR-CFG-03 / BR-R12 (reason is mandatory, min 15). */
export class ReopenPeriodDto {
  @IsString()
  @Length(15, 1000)
  reason!: string;
}

/** POST /admin/periods/extensions — FR-CFG-04 / EC-09. */
export class GrantExtensionDto {
  @IsUUID()
  kpiId!: string;

  @IsInt()
  @Min(1)
  @Max(30)
  days!: number;

  @IsString()
  @Length(15, 1000)
  reason!: string;
}

/** GET /admin/periods/extensions. */
export class ListExtensionsQueryDto {
  @IsOptional()
  @IsUUID()
  periodId?: string;

  @IsOptional()
  @IsString()
  page?: string;

  @IsOptional()
  @IsString()
  size?: string;
}

/** GET /admin/periods/current?frequency=MONTHLY. */
export class CurrentPeriodQueryDto {
  @IsOptional()
  @IsEnum(Frequency)
  frequency?: Frequency;
}
