import { AuthUser } from '../interfaces/auth-user.interface';
import { ROLE_PERMISSIONS, RoleKey, PERM } from '../constants';

interface ScopeSource {
  id: string;
  email: string;
  fullName: string;
  employeeCode: string;
  businessUnitId: string | null;
  departmentId: string | null;
  breakGlassAccess?: boolean;
  organisationConfirmed?: boolean;
  roles: Array<{ role: { code: string } }>;
  scopes: Array<{
    roleId: string;
    departmentId: string | null;
    businessUnitId: string | null;
    role: { code: string };
  }>;
}

/**
 * Rebuilds the AuthUser principal (roles + permissions + data scope) from a user
 * row. Used by the queue workers, which run outside a request context.
 */
export const SCOPE_REBUILD = (user: ScopeSource, sessionId = 'system'): AuthUser => {
  const roles = user.roles.map((r) => r.role.code) as RoleKey[];
  const permissions = Array.from(new Set(roles.flatMap((r) => ROLE_PERMISSIONS[r] ?? [])));

  const group = roles.some((r) =>
    [('SUPER_ADMIN' as RoleKey), 'HR_ADMIN' as RoleKey, 'MGMT_VIEWER' as RoleKey].includes(r),
  );

  const departmentIds = new Set<string>();
  const businessUnitIds = new Set<string>();

  if (!group) {
    for (const scope of user.scopes) {
      if (scope.departmentId) departmentIds.add(scope.departmentId);
      if (scope.businessUnitId) businessUnitIds.add(scope.businessUnitId);
    }
    // Department Heads implicitly cover their own department.
    if (roles.includes('DEPT_HEAD' as RoleKey) && user.departmentId) {
      departmentIds.add(user.departmentId);
    }
  }

  const ownOnly =
    !group &&
    departmentIds.size === 0 &&
    businessUnitIds.size === 0 &&
    !permissions.includes(PERM.DASHBOARD_DEPT) &&
    !permissions.includes(PERM.KPI_VIEW_OTHERS);

  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    employeeCode: user.employeeCode,
    roles,
    permissions,
    scope: {
      group,
      departmentIds: Array.from(departmentIds),
      businessUnitIds: Array.from(businessUnitIds),
      ownOnly,
    },
    businessUnitId: user.businessUnitId,
    departmentId: user.departmentId,
    sessionId,
    sessionVersion: 0,
    breakGlassAccess: user.breakGlassAccess ?? false,
    organisationConfirmed: user.organisationConfirmed ?? true,
  };
};
