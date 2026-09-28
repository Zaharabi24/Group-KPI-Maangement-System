import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MinLength,
  MaxLength,
  IsBoolean,
} from 'class-validator';
import { Transform } from 'class-transformer';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const lower = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() : value);

export class RegisterDto {
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

  @IsOptional()
  @IsString()
  @Length(2, 160)
  @Transform(trim)
  designationTitle?: string;
}

export class SetPasswordDto {
  @IsString()
  @IsNotEmpty()
  token!: string;

  @IsString()
  @MinLength(10)
  @MaxLength(64)
  password!: string;

  @IsString()
  @IsNotEmpty()
  confirmPassword!: string;
}

export class LoginDto {
  @IsEmail()
  @Transform(lower)
  email!: string;

  @IsString()
  @IsNotEmpty()
  password!: string;

  @IsOptional()
  @IsBoolean()
  rememberMe?: boolean;
}

export class ForgotPasswordDto {
  @IsEmail()
  @Transform(lower)
  email!: string;
}

export class ResetPasswordDto {
  @IsString()
  @IsNotEmpty()
  token!: string;

  @IsString()
  @MinLength(10)
  @MaxLength(64)
  password!: string;

  @IsString()
  @IsNotEmpty()
  confirmPassword!: string;
}

export class ChangePasswordDto {
  @IsString()
  @IsNotEmpty()
  currentPassword!: string;

  @IsString()
  @MinLength(10)
  @MaxLength(64)
  newPassword!: string;

  @IsString()
  @IsNotEmpty()
  confirmPassword!: string;
}

export class UpdateProfileDto {
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

export class InviteUserDto {
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
  @IsString()
  @Length(2, 160)
  @Transform(trim)
  designationTitle?: string;
}

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @Length(3, 160)
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
  designationTitle?: string;

  @IsOptional()
  @IsUUID()
  designationId?: string;
}

export class TransferUserDto {
  @IsUUID()
  departmentId!: string;

  @IsString()
  @Length(15, 1000)
  reason!: string;
}

export class RolesDto {
  @IsString({ each: true })
  roleCodes!: string[];
}

export class DeactivateUserDto {
  @IsString()
  @Length(15, 1000)
  reason!: string;
}

export class DelegationDto {
  @IsUUID()
  toUserId!: string;

  @IsUUID()
  departmentId!: string;

  @IsString()
  startDate!: string;

  @IsString()
  endDate!: string;

  @IsOptional()
  @IsString()
  @Length(0, 500)
  reason?: string;
}

export class IdsDto {
  @IsString({ each: true })
  ids!: string[];
}

export class RefreshDto {
  @IsOptional()
  @IsString()
  refreshToken?: string;
}

export class PaginationQueryDto {
  @IsOptional()
  page?: number;

  @IsOptional()
  size?: number;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  sort?: string;

  @IsOptional()
  @IsString()
  order?: 'asc' | 'desc';
}

export class UpdateBusinessUnitDto {
  @IsOptional()
  @IsString()
  @Length(2, 160)
  name?: string;

  @IsOptional()
  @IsString()
  @Length(1, 16)
  code?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsString()
  @Length(0, 64)
  shortName?: string;

  @IsOptional()
  @IsString()
  @Length(0, 80)
  division?: string;
}

export class CreateDepartmentDto {
  @IsUUID()
  businessUnitId!: string;

  @IsString()
  @Length(2, 160)
  name!: string;

  @IsOptional()
  @IsString()
  @Length(1, 24)
  code?: string;
}

export class UpdateDepartmentDto {
  @IsOptional()
  @IsUUID()
  businessUnitId?: string;

  @IsOptional()
  @IsString()
  @Length(2, 160)
  name?: string;

  @IsOptional()
  @IsString()
  @Length(1, 24)
  code?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
