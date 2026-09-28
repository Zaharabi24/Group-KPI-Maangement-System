import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { Transform, Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  ValidateNested,
} from 'class-validator';
import {
  BulkImportRow,
  CreateDelegationInput,
  DirectoryQuery,
  InviteUserInput,
  ListDelegationsQuery,
  ListInvitationsQuery,
  ListUsersQuery,
  TransferUserInput,
  UpdateProfileInput,
  UpdateUserInput,
  UsersService,
} from './users.service';
import {
  AnyPermission,
  CurrentUser,
  Permissions,
  RequestMeta,
  Roles,
} from '../../common/decorators';
import { AuthUser, RequestContextMeta } from '../../common/interfaces/auth-user.interface';
import { PERM, ROLE } from '../../common/constants';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const lower = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() : value);

// ------------------------------------------------------------------------ DTOs

export class UpdateProfileDto implements UpdateProfileInput {
  @IsOptional()
  @IsString()
  @Matches(/^(01[3-9]\d{8}|\+8801[3-9]\d{8})$/, {
    message: 'Enter a valid Bangladeshi mobile number, e.g. 01712345678 or +8801712345678',
  })
  corporatePhone?: string;

  @IsOptional()
  @IsBoolean()
  emailDigest?: boolean;

  @IsOptional()
  @IsString()
  @Length(2, 160)
  @Transform(trim)
  designationTitle?: string;
}

export class ListUsersQueryDto implements ListUsersQuery {
  @IsOptional() @IsString() page?: string;
  @IsOptional() @IsString() size?: string;
  @IsOptional() @IsString() businessUnitId?: string;
  @IsOptional() @IsString() departmentId?: string;
  @IsOptional() @IsString() roleCode?: string;
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() search?: string;
  @IsOptional() @IsString() sort?: string;
  @IsOptional() @IsString() order?: string;
}

export class InviteUserDto implements InviteUserInput {
  @IsString()
  @Length(3, 160)
  @Transform(trim)
  fullName!: string;

  @IsEmail()
  @Transform(lower)
  email!: string;

  @IsString()
  @Length(2, 32)
  @Transform(trim)
  employeeCode!: string;

  @IsUUID()
  businessUnitId!: string;

  @IsUUID()
  departmentId!: string;

  @IsString()
  @IsNotEmpty()
  roleCode!: string;

  @IsOptional()
  @IsUUID()
  designationId?: string;

  @IsOptional()
  @IsString()
  @Length(2, 160)
  @Transform(trim)
  designationTitle?: string;
}

export class ListInvitationsQueryDto implements ListInvitationsQuery {
  @IsOptional() @IsString() page?: string;
  @IsOptional() @IsString() size?: string;
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() search?: string;
}

export class UpdateUserDto implements UpdateUserInput {
  @IsOptional()
  @IsString()
  @Length(3, 160)
  @Transform(trim)
  fullName?: string;

  @IsOptional()
  @IsUUID()
  businessUnitId?: string;

  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @IsOptional()
  @IsString()
  @Length(2, 160)
  @Transform(trim)
  designationTitle?: string;

  @IsOptional()
  @IsUUID()
  designationId?: string;
}

export class TransferUserDto implements TransferUserInput {
  @IsUUID()
  departmentId!: string;

  @IsString()
  @Length(15, 1000)
  @Transform(trim)
  reason!: string;
}

export class AssignRolesDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  roleCodes!: string[];
}

export class DeactivateUserDto {
  @IsString()
  @Length(15, 1000)
  @Transform(trim)
  reason!: string;
}

export class BulkImportRowDto {
  @IsString() @IsNotEmpty() @Transform(trim) fullName!: string;
  @IsEmail() @Transform(lower) email!: string;
  @IsString() @IsNotEmpty() @Transform(trim) employeeCode!: string;
  @IsString() @IsNotEmpty() @Transform(trim) businessUnitCode!: string;
  @IsString() @IsNotEmpty() @Transform(trim) departmentName!: string;
  @IsOptional() @IsString() @Transform(trim) roleCode?: string;
  @IsOptional() @IsString() @Transform(trim) designationTitle?: string;
}

export class BulkImportDto {
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => BulkImportRowDto)
  rows!: BulkImportRowDto[];
}

export class CreateDelegationDto implements CreateDelegationInput {
  @IsUUID()
  toUserId!: string;

  @IsUUID()
  departmentId!: string;

  @IsString()
  @IsNotEmpty()
  startDate!: string;

  @IsString()
  @IsNotEmpty()
  endDate!: string;

  @IsOptional()
  @IsString()
  @Length(0, 500)
  @Transform(trim)
  reason?: string;
}

export class ListDelegationsQueryDto implements ListDelegationsQuery {
  @IsOptional() @IsString() page?: string;
  @IsOptional() @IsString() size?: string;
  @IsOptional() @IsString() departmentId?: string;
  @IsOptional() @IsString() activeOnly?: string;
}

export class ApproversQueryDto {
  @IsUUID()
  departmentId!: string;
}

export class DirectoryQueryDto implements DirectoryQuery {
  @IsOptional() @IsString() search?: string;
  @IsOptional() @IsString() departmentId?: string;
  @IsOptional() @IsString() limit?: string;
}

// ---------------------------------------------------------------- controller

@Controller()
export class UsersController {
  constructor(private readonly users: UsersService) {}

  // ------------------------------------------------------------- FR-PRF-01..05

  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.users.me(user.id);
  }

  @Patch('me')
  updateMe(
    @Body() dto: UpdateProfileDto,
    @CurrentUser() user: AuthUser,
    @RequestMeta() meta: RequestContextMeta,
  ) {
    return this.users.updateProfile(user.id, dto, meta);
  }

  // ------------------------------------------------------------- shared lookups

  /** Any authenticated user — the KPI form needs the approver drop-down. */
  @Get('users/approvers')
  approvers(@Query() query: ApproversQueryDto, @CurrentUser() user: AuthUser) {
    return this.users.approvers(query.departmentId, user.id);
  }

  /** Any authenticated user — scope-filtered people picker for global search. */
  @Get('users/directory')
  directory(@Query() query: DirectoryQueryDto, @CurrentUser() user: AuthUser) {
    return this.users.directory(query, user);
  }

  // ------------------------------------------------------------- admin · users

  @Get('admin/users')
  @AnyPermission(PERM.USER_MANAGE, PERM.USER_INVITE, PERM.KPI_VIEW_OTHERS)
  list(@Query() query: ListUsersQueryDto, @CurrentUser() user: AuthUser) {
    return this.users.list(query, user);
  }

  @Get('admin/users/:id')
  @AnyPermission(PERM.USER_MANAGE, PERM.USER_INVITE, PERM.KPI_VIEW_OTHERS)
  get(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.users.get(id, user);
  }

  @Patch('admin/users/:id')
  @Permissions(PERM.USER_MANAGE)
  update(
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
    @CurrentUser() user: AuthUser,
    @RequestMeta() meta: RequestContextMeta,
  ) {
    return this.users.update(id, dto, user, meta);
  }

  @Post('admin/users/:id/transfer')
  @Permissions(PERM.USER_MANAGE)
  @HttpCode(HttpStatus.OK)
  transfer(
    @Param('id') id: string,
    @Body() dto: TransferUserDto,
    @CurrentUser() user: AuthUser,
    @RequestMeta() meta: RequestContextMeta,
  ) {
    return this.users.transfer(id, dto, user, meta);
  }

  @Post('admin/users/:id/roles')
  @Permissions(PERM.USER_MANAGE)
  @HttpCode(HttpStatus.OK)
  assignRoles(
    @Param('id') id: string,
    @Body() dto: AssignRolesDto,
    @CurrentUser() user: AuthUser,
    @RequestMeta() meta: RequestContextMeta,
  ) {
    return this.users.assignRoles(id, dto.roleCodes, user, meta);
  }

  @Post('admin/users/:id/deactivate')
  @Permissions(PERM.USER_MANAGE)
  @HttpCode(HttpStatus.OK)
  deactivate(
    @Param('id') id: string,
    @Body() dto: DeactivateUserDto,
    @CurrentUser() user: AuthUser,
    @RequestMeta() meta: RequestContextMeta,
  ) {
    return this.users.deactivate(id, dto, user, meta);
  }

  @Post('admin/users/:id/reactivate')
  @Permissions(PERM.USER_MANAGE)
  @HttpCode(HttpStatus.OK)
  reactivate(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @RequestMeta() meta: RequestContextMeta,
  ) {
    return this.users.reactivate(id, user, meta);
  }

  @Post('admin/users/bulk-import')
  @Permissions(PERM.USER_MANAGE)
  @HttpCode(HttpStatus.OK)
  bulkImport(
    @Body() dto: BulkImportDto,
    @CurrentUser() user: AuthUser,
    @RequestMeta() meta: RequestContextMeta,
  ) {
    return this.users.bulkImport(dto.rows as BulkImportRow[], user, meta);
  }

  // ------------------------------------------------------- admin · invitations

  @Post('admin/invitations')
  @Permissions(PERM.USER_INVITE)
  invite(
    @Body() dto: InviteUserDto,
    @CurrentUser() user: AuthUser,
    @RequestMeta() meta: RequestContextMeta,
  ) {
    return this.users.invite(dto, user, meta);
  }

  @Get('admin/invitations')
  @AnyPermission(PERM.USER_MANAGE, PERM.USER_INVITE)
  listInvitations(@Query() query: ListInvitationsQueryDto, @CurrentUser() user: AuthUser) {
    return this.users.listInvitations(query, user);
  }

  @Post('admin/invitations/:id/resend')
  @Permissions(PERM.USER_INVITE)
  @HttpCode(HttpStatus.OK)
  resendInvitation(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @RequestMeta() meta: RequestContextMeta,
  ) {
    return this.users.resendInvitation(id, user, meta);
  }

  @Post('admin/invitations/:id/revoke')
  @Permissions(PERM.USER_INVITE)
  @HttpCode(HttpStatus.OK)
  revokeInvitation(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @RequestMeta() meta: RequestContextMeta,
  ) {
    return this.users.revokeInvitation(id, user, meta);
  }

  // ------------------------------------------------------- admin · delegations

  /** FR-ORG-08 — approver delegation (Department Head ↔ Department Head). */
  @Post('admin/delegations')
  @Roles(ROLE.DEPT_HEAD, ROLE.SUPER_ADMIN)
  createDelegation(
    @Body() dto: CreateDelegationDto,
    @CurrentUser() user: AuthUser,
    @RequestMeta() meta: RequestContextMeta,
  ) {
    return this.users.createDelegation(dto, user, meta);
  }

  @Get('admin/delegations')
  @Roles(ROLE.DEPT_HEAD, ROLE.SUPER_ADMIN)
  listDelegations(@Query() query: ListDelegationsQueryDto, @CurrentUser() user: AuthUser) {
    return this.users.listDelegations(query, user);
  }

  @Delete('admin/delegations/:id')
  @Roles(ROLE.DEPT_HEAD, ROLE.SUPER_ADMIN)
  revokeDelegation(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @RequestMeta() meta: RequestContextMeta,
  ) {
    return this.users.revokeDelegation(id, user, meta);
  }

  // ------------------------------------------------------ admin · registrations

  @Get('admin/registrations')
  @AnyPermission(PERM.USER_MANAGE, PERM.USER_INVITE, PERM.KPI_VIEW_OTHERS)
  pendingRegistrations(@CurrentUser() user: AuthUser) {
    return this.users.pendingRegistrations(user);
  }

  @Post('admin/registrations/:id/confirm')
  @AnyPermission(PERM.USER_MANAGE, PERM.KPI_VIEW_OTHERS)
  @HttpCode(HttpStatus.OK)
  confirmRegistration(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @RequestMeta() meta: RequestContextMeta,
  ) {
    return this.users.confirmRegistration(id, user, meta);
  }
}
