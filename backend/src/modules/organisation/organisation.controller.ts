import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Min,
} from 'class-validator';
import { OrganisationService } from './organisation.service';
import { AuthUser, RequestContextMeta } from '../../common/interfaces/auth-user.interface';
import { CurrentUser, Permissions, Public, RequestMeta } from '../../common/decorators';
import { PERM } from '../../common/constants';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

// ------------------------------------------------------------------------ DTOs

export class CreateBusinessUnitDto {
  @IsString()
  @Length(2, 160)
  @Transform(trim)
  name!: string;

  @IsString()
  @Length(1, 16)
  @Transform(trim)
  code!: string;

  @IsOptional()
  @IsString()
  @Length(0, 64)
  @Transform(trim)
  shortName?: string;

  @IsOptional()
  @IsString()
  @Length(0, 80)
  @Transform(trim)
  division?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

export class UpdateBusinessUnitDto {
  @IsOptional()
  @IsString()
  @Length(2, 160)
  @Transform(trim)
  name?: string;

  @IsOptional()
  @IsString()
  @Length(1, 16)
  @Transform(trim)
  code?: string;

  @IsOptional()
  @IsString()
  @Length(0, 64)
  @Transform(trim)
  shortName?: string;

  @IsOptional()
  @IsString()
  @Length(0, 80)
  @Transform(trim)
  division?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

export class CreateDepartmentDto {
  @IsUUID()
  businessUnitId!: string;

  @IsString()
  @Length(2, 160)
  @Transform(trim)
  name!: string;

  @IsOptional()
  @IsString()
  @Length(1, 24)
  @Transform(trim)
  code?: string;
}

export class UpdateDepartmentDto {
  @IsOptional()
  @IsUUID()
  businessUnitId?: string;

  @IsOptional()
  @IsString()
  @Length(2, 160)
  @Transform(trim)
  name?: string;

  @IsOptional()
  @IsString()
  @Length(1, 24)
  @Transform(trim)
  code?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

// ---------------------------------------------------------------- controller

@Controller('organisation')
export class OrganisationController {
  constructor(private readonly organisation: OrganisationService) {}

  // --------------------------------------------------- public (registration) reads

  /** No auth — the self-registration form needs the business unit list. */
  @Public()
  @Get('public/business-units')
  publicBusinessUnits() {
    return this.organisation.listBusinessUnits(false);
  }

  /** No auth — the self-registration form needs departments of a business unit. */
  @Public()
  @Get('public/departments')
  publicDepartments(@Query('businessUnitId') businessUnitId?: string) {
    return this.organisation.listDepartments(businessUnitId, false);
  }

  // ------------------------------------------- authenticated reads (any role)

  /** Any authenticated user — used by the registration and profile forms. */
  @Get('business-units')
  businessUnits(@Query('includeInactive') includeInactive?: string) {
    return this.organisation.listBusinessUnits(includeInactive === 'true');
  }

  /** Any authenticated user — used by the registration and profile forms. */
  @Get('departments')
  departments(
    @Query('businessUnitId') businessUnitId?: string,
    @Query('includeInactive') includeInactive?: string,
  ) {
    return this.organisation.listDepartments(businessUnitId, includeInactive === 'true');
  }

  // ------------------------------------------------------------ admin (ORG_MANAGE)

  @Get('tree')
  @Permissions(PERM.ORG_MANAGE)
  tree() {
    return this.organisation.tree();
  }

  @Get('designations')
  @Permissions(PERM.ORG_MANAGE)
  designations() {
    return this.organisation.designations();
  }

  @Post('business-units')
  @Permissions(PERM.ORG_MANAGE)
  @HttpCode(HttpStatus.CREATED)
  createBusinessUnit(
    @Body() dto: CreateBusinessUnitDto,
    @CurrentUser() user: AuthUser,
    @RequestMeta() meta: RequestContextMeta,
  ) {
    return this.organisation.createBusinessUnit(dto, user, meta);
  }

  @Patch('business-units/:id')
  @Permissions(PERM.ORG_MANAGE)
  updateBusinessUnit(
    @Param('id') id: string,
    @Body() dto: UpdateBusinessUnitDto,
    @CurrentUser() user: AuthUser,
    @RequestMeta() meta: RequestContextMeta,
  ) {
    return this.organisation.updateBusinessUnit(id, dto, user, meta);
  }

  @Post('business-units/:id/deactivate')
  @Permissions(PERM.ORG_MANAGE)
  @HttpCode(HttpStatus.OK)
  deactivateBusinessUnit(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @RequestMeta() meta: RequestContextMeta,
  ) {
    return this.organisation.deactivateBusinessUnit(id, user, meta);
  }

  @Post('departments')
  @Permissions(PERM.ORG_MANAGE)
  @HttpCode(HttpStatus.CREATED)
  createDepartment(
    @Body() dto: CreateDepartmentDto,
    @CurrentUser() user: AuthUser,
    @RequestMeta() meta: RequestContextMeta,
  ) {
    return this.organisation.createDepartment(dto, user, meta);
  }

  @Patch('departments/:id')
  @Permissions(PERM.ORG_MANAGE)
  updateDepartment(
    @Param('id') id: string,
    @Body() dto: UpdateDepartmentDto,
    @CurrentUser() user: AuthUser,
    @RequestMeta() meta: RequestContextMeta,
  ) {
    return this.organisation.updateDepartment(id, dto, user, meta);
  }

  @Post('departments/:id/deactivate')
  @Permissions(PERM.ORG_MANAGE)
  @HttpCode(HttpStatus.OK)
  deactivateDepartment(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @RequestMeta() meta: RequestContextMeta,
  ) {
    return this.organisation.deactivateDepartment(id, user, meta);
  }
}
