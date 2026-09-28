import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import {
  Direction,
  KpiType,
  MeasurementType,
  TemplateScope,
} from '@prisma/client';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/** GET /kpi-library/templates — visible templates. */
export class ListTemplatesQueryDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @IsOptional()
  @IsEnum(MeasurementType)
  measurementType?: MeasurementType;

  @IsOptional()
  @IsEnum(TemplateScope)
  scope?: TemplateScope;

  @IsOptional()
  @IsString()
  isPublished?: string;

  @IsOptional()
  @IsString()
  page?: string;

  @IsOptional()
  @IsString()
  size?: string;
}

/** POST /kpi-library/templates — FR-LIB-01. */
export class CreateTemplateDto {
  @IsString()
  @Length(3, 160)
  @Transform(trim)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  @Transform(trim)
  description?: string;

  @IsUUID()
  categoryId!: string;

  @IsOptional()
  @IsEnum(KpiType)
  kpiType?: KpiType;

  @IsEnum(MeasurementType)
  measurementType!: MeasurementType;

  @IsString()
  @Length(1, 32)
  @Transform(trim)
  unit!: string;

  @IsEnum(Direction)
  direction!: Direction;

  @IsInt()
  @Min(1)
  @Max(100)
  suggestedWeight!: number;

  @IsOptional()
  rubricDescriptors?: Record<string, string> | string[] | null;

  @IsOptional()
  @IsBoolean()
  isPublished?: boolean;
}

/** PATCH /kpi-library/templates/:id — FR-LIB-05 (creates a new version). */
export class UpdateTemplateDto {
  @IsOptional()
  @IsString()
  @Length(3, 160)
  @Transform(trim)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  @Transform(trim)
  description?: string;

  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @IsOptional()
  @IsEnum(KpiType)
  kpiType?: KpiType;

  @IsOptional()
  @IsEnum(MeasurementType)
  measurementType?: MeasurementType;

  @IsOptional()
  @IsString()
  @Length(1, 32)
  @Transform(trim)
  unit?: string;

  @IsOptional()
  @IsEnum(Direction)
  direction?: Direction;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  suggestedWeight?: number;

  @IsOptional()
  rubricDescriptors?: Record<string, string> | string[] | null;
}

/** POST /kpi-library/templates/:id/publish. */
export class PublishTemplateDto {
  @IsBoolean()
  isPublished!: boolean;
}

/** FR-LIB-03 / UC-08 — one assignment row per employee. */
export class AssignmentRowDto {
  @IsUUID()
  employeeId!: string;

  @IsOptional()
  target?: string | number | null;

  @IsInt()
  @Min(1)
  @Max(100)
  weight!: number;
}

/** POST /kpi-library/assignments — FR-LIB-03 / UC-08. */
export class AssignTemplateDto {
  @IsUUID()
  templateId!: string;

  @IsUUID()
  periodId!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AssignmentRowDto)
  rows!: AssignmentRowDto[];
}
