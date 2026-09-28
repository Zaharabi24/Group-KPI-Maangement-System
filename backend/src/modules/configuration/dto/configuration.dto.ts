import {
  IsArray,
  IsDateString,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
} from 'class-validator';
import { Transform } from 'class-transformer';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/**
 * FR-CFG-02 / §4.9 — publish a new immutable configuration version.
 * Every field is optional; omitted values fall back to the currently active
 * configuration (or the platform defaults) so a partial publish is safe.
 */
export class PublishConfigurationDto {
  @IsOptional()
  @IsDateString()
  effectiveFrom?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  scoreCap?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  scoreFloor?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  adjustmentBand?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  minWeight?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  maxWeight?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  maxKpisPerPeriod?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  submissionGraceDays?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  reviewWindowDays?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  reviewSlaDays?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  extensionMaxDays?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  minReasonLength?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  maxEvidenceFiles?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  maxEvidenceSizeMb?: number;

  @IsOptional()
  @IsObject()
  qualitativeMap?: Record<string, number>;

  @IsOptional()
  @IsObject()
  ragThresholds?: { green: number; amber: number };

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  categories?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  allowedMimeTypes?: string[];

  @IsOptional()
  @IsString()
  @Length(0, 1000)
  @Transform(trim)
  notes?: string;
}

/** §4.9 — recalculate an open period with the active configuration. */
export class RecalculateConfigurationDto {
  @IsUUID()
  periodId!: string;

  @IsString()
  @Length(15, 1000)
  @Transform(trim)
  reason!: string;
}
