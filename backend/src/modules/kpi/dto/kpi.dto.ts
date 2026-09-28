import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';

export const MEASUREMENT_TYPES = ['COUNT', 'MONETARY', 'PERCENTAGE', 'TIME', 'RATING', 'QUALITATIVE'] as const;
export const DIRECTIONS = ['HIGHER', 'LOWER'] as const;
export const FREQUENCIES = ['MONTHLY', 'QUARTERLY', 'YEARLY'] as const;

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class CreateKpiDto {
  @IsString()
  @Length(3, 120)
  @Transform(trim)
  name!: string;

  @IsOptional()
  @IsString()
  @Length(0, 500)
  @Transform(trim)
  description?: string;

  @IsUUID()
  categoryId!: string;

  @IsOptional()
  @IsString()
  @Length(1, 40)
  kpiType?: string;

  @IsIn(MEASUREMENT_TYPES as unknown as string[])
  measurementType!: (typeof MEASUREMENT_TYPES)[number];

  @IsOptional()
  @IsString()
  @Length(1, 32)
  @Transform(trim)
  unit?: string;

  @IsIn(DIRECTIONS as unknown as string[])
  direction!: (typeof DIRECTIONS)[number];

  @IsIn(FREQUENCIES as unknown as string[])
  frequency!: (typeof FREQUENCIES)[number];

  @IsUUID()
  periodId!: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  target?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  actual?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  rubricLevel?: number;

  @IsInt()
  @Min(1)
  @Max(100)
  kpiWeight!: number;

  @IsOptional()
  @IsString()
  @Length(0, 1000)
  @Transform(trim)
  remarks?: string;

  @IsOptional()
  @IsUUID()
  approverId?: string;

  @IsOptional()
  @IsUUID()
  templateId?: string;
}

export class UpdateKpiDto {
  @IsOptional()
  @IsString()
  @Length(3, 120)
  @Transform(trim)
  name?: string;

  @IsOptional()
  @IsString()
  @Length(0, 500)
  @Transform(trim)
  description?: string;

  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @IsOptional()
  @IsIn(MEASUREMENT_TYPES as unknown as string[])
  measurementType?: (typeof MEASUREMENT_TYPES)[number];

  @IsOptional()
  @IsString()
  @Length(1, 32)
  @Transform(trim)
  unit?: string;

  @IsOptional()
  @IsIn(DIRECTIONS as unknown as string[])
  direction?: (typeof DIRECTIONS)[number];

  @IsOptional()
  @IsIn(FREQUENCIES as unknown as string[])
  frequency?: (typeof FREQUENCIES)[number];

  @IsOptional()
  @IsUUID()
  periodId?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  target?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  actual?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  rubricLevel?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  kpiWeight?: number;

  @IsOptional()
  @IsString()
  @Length(0, 1000)
  @Transform(trim)
  remarks?: string;

  @IsOptional()
  @IsUUID()
  approverId?: string;

  /** Applied by an approver during review — the reason is mandatory in that path. */
  @IsOptional()
  @IsString()
  @Length(0, 1000)
  reason?: string;

  @IsOptional()
  @IsString()
  @Length(0, 1000)
  changeNote?: string;
}

export class PreviewCalculationDto {
  @IsIn(MEASUREMENT_TYPES as unknown as string[])
  measurementType!: (typeof MEASUREMENT_TYPES)[number];

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  target?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  actual?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  rubricLevel?: number;

  @IsIn(DIRECTIONS as unknown as string[])
  direction!: (typeof DIRECTIONS)[number];

  @IsInt()
  @Min(1)
  @Max(100)
  kpiWeight!: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  overrideScore?: number;
}

export class KpiListQueryDto {
  @IsOptional()
  @IsString()
  frequency?: string;

  @IsOptional()
  @IsString()
  periodId?: string;

  @IsOptional()
  @IsString()
  periodCode?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsString()
  page?: string;

  @IsOptional()
  @IsString()
  size?: string;
}

export class AttachEvidenceDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5)
  @IsString({ each: true })
  evidenceIds!: string[];
}

export class RestoreVersionDto {
  @IsInt()
  @Min(1)
  versionNo!: number;

  @IsString()
  @Length(15, 1000)
  reason!: string;
}

export class CorrectionRequestDto {
  @IsUUID()
  kpiId!: string;

  @IsString()
  @Length(15, 1000)
  reason!: string;

  @IsOptional()
  @IsObject()
  changes?: Record<string, unknown>;
}

export class CorrectionDecisionDto {
  @IsIn(['APPROVE', 'DECLINE'])
  decision!: 'APPROVE' | 'DECLINE';

  @IsOptional()
  @IsString()
  @Length(0, 1000)
  comment?: string;
}

export class BulkEvidenceItemDto {
  @IsString()
  originalName!: string;

  @IsString()
  base64!: string;
}

export class BulkEvidenceDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5)
  @ValidateNested({ each: true })
  @Type(() => BulkEvidenceItemDto)
  files!: BulkEvidenceItemDto[];
}

export class DeleteKpiDto {
  @IsString()
  @Length(15, 1000)
  reason!: string;
}

export class WithdrawDto {
  @IsOptional()
  @IsString()
  @Length(0, 500)
  reason?: string;
}
