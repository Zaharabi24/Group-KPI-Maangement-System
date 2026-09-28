import { RoleKey } from '../constants';

/** The authenticated principal attached to `request.user` by JwtStrategy. */
export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  employeeCode: string;
  roles: RoleKey[];
  /** Resolved permissions = union of ROLE_PERMISSIONS for the user's roles. */
  permissions: string[];
  /**
   * Data scope (§5.3):
   *  - group: true when the user holds a group-scoped role (SUPER_ADMIN/HR/MGMT/SYS)
   *  - departmentIds: departments the user may read (empty + group=false → own records only)
   *  - businessUnitIds: BUs the user may read
   */
  scope: {
    group: boolean;
    departmentIds: string[];
    businessUnitIds: string[];
    ownOnly: boolean;
  };
  businessUnitId: string | null;
  departmentId: string | null;
  sessionId: string;
  sessionVersion: number;
  breakGlassAccess: boolean;
  organisationConfirmed: boolean;
}

export interface RequestContextMeta {
  ip?: string;
  userAgent?: string;
  correlationId?: string;
}

export interface Paginated<T> {
  items: T[];
  page: number;
  size: number;
  total: number;
  totalPages: number;
}
