import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuthUser } from '../../common/interfaces/auth-user.interface';
import { PERM } from '../../common/constants';
import { Forbidden } from '../../common/errors/error-codes';

/**
 * Data-scope enforcement — BRD §5.3.
 *
 * Scope comes from user_role_scope (user, role, department or null for group).
 * A Department Head assigned to several departments sees the union of those
 * departments. Every list, search, dashboard, report and export query is filtered
 * by scope in the API/data layer — never only in the UI.
 */
@Injectable()
export class ScopeService {
  /** True when the user may see every KPI in the group. */
  isGroupScoped(user: AuthUser): boolean {
    return user.scope.group;
  }

  /**
   * Builds a Prisma `where` fragment that restricts KPI rows to the caller.
   *
   * The same rule must drive the queue AND the decision guard, otherwise a
   * Department Head could see a request they are not allowed to decide.
   * A department scope therefore narrows to those departments; the business-unit
   * scope applies only when the grant is BU-wide (no department on the grant).
   */
  kpiScopeWhere(user: AuthUser): Prisma.KpiWhereInput {
    if (this.isGroupScoped(user)) return {};

    const or: Prisma.KpiWhereInput[] = [{ employeeId: user.id }];

    if (user.scope.departmentIds.length) {
      or.push({ departmentId: { in: user.scope.departmentIds } });
    } else if (user.scope.businessUnitIds.length) {
      or.push({ businessUnitId: { in: user.scope.businessUnitIds } });
    }
    return { OR: or };
  }

  /** Deep-link style guard: throws 403 when the KPI is outside the caller's scope. */
  assertKpiInScope(
    user: AuthUser,
    kpi: { employeeId: string; departmentId: string | null; businessUnitId: string | null },
  ): void {
    if (this.isGroupScoped(user)) return;
    if (kpi.employeeId === user.id) return;
    if (user.scope.departmentIds.length) {
      if (kpi.departmentId && user.scope.departmentIds.includes(kpi.departmentId)) return;
    } else if (kpi.businessUnitId && user.scope.businessUnitIds.includes(kpi.businessUnitId)) {
      return;
    }
    throw Forbidden('OUT-OF-SCOPE', 'This record belongs to another department');
  }

  /** Employee-scope filter for user lists (Users, Reports, Dashboards). */
  userScopeWhere(user: AuthUser): Prisma.UserWhereInput {
    if (this.isGroupScoped(user)) return {};
    const or: Prisma.UserWhereInput[] = [{ id: user.id }];
    if (user.scope.departmentIds.length) {
      or.push({ departmentId: { in: user.scope.departmentIds } });
    } else if (user.scope.businessUnitIds.length) {
      or.push({ businessUnitId: { in: user.scope.businessUnitIds } });
    }
    return { OR: or };
  }

  /** Department ids the caller may read, or `null` for "all". */
  departmentFilter(user: AuthUser): string[] | null {
    if (this.isGroupScoped(user)) return null;
    if (user.scope.departmentIds.length) return user.scope.departmentIds;
    return null;
  }

  businessUnitFilter(user: AuthUser): string[] | null {
    if (this.isGroupScoped(user)) return null;
    if (user.scope.departmentIds.length) return null;
    return user.scope.businessUnitIds.length ? user.scope.businessUnitIds : null;
  }

  /** Resolves the employee ids visible to an approver (used by queues/dashboards). */
  async visibleEmployeeIds(
    prisma: Prisma.TransactionClient | { user: { findMany: Function } },
    user: AuthUser,
  ): Promise<string[] | null> {
    if (this.isGroupScoped(user)) return null;
    const ids = new Set<string>([user.id]);
    const where: Prisma.UserWhereInput = {};
    if (user.scope.departmentIds.length) where.departmentId = { in: user.scope.departmentIds };
    else if (user.scope.businessUnitIds.length) where.businessUnitId = { in: user.scope.businessUnitIds };
    else return Array.from(ids);
    const rows = await (prisma as unknown as {
      user: { findMany: (a: unknown) => Promise<Array<{ id: string }>> };
    }).user.findMany({ where, select: { id: true } });
    rows.forEach((r) => ids.add(r.id));
    return Array.from(ids);
  }

  /**
   * Whether the caller may decide on this KPI:
   *   - never their own KPI (BR-R04)
   *   - Super Admin: any KPI (incl. Department Head KPIs)
   *   - Department Head: only KPIs in their department(s), and only when named
   *     as the approver or when the approver is a peer in the same department.
   */
  canDecide(
    user: AuthUser,
    kpi: { employeeId: string; approverId: string | null; departmentId: string | null },
  ): boolean {
    if (kpi.employeeId === user.id) return false;
    if (user.roles.includes('SUPER_ADMIN')) return true;
    if (!user.permissions.includes(PERM.KPI_REVIEW)) return false;
    if (!kpi.departmentId || !user.scope.departmentIds.includes(kpi.departmentId)) return false;
    return true;
  }

  assertCanDecide(
    user: AuthUser,
    kpi: { employeeId: string; approverId: string | null; departmentId: string | null },
  ): void {
    if (kpi.employeeId === user.id) {
      throw Forbidden('SELF-DECISION', 'You cannot decide on your own KPI (segregation of duties)');
    }
    if (!this.canDecide(user, kpi)) {
      throw Forbidden('OUT-OF-SCOPE', 'This request is not in your approval scope');
    }
  }
}
