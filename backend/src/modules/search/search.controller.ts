import { Controller, Get, Query } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ScopeService } from '../../common/scope/scope.service';
import { KpiService } from '../kpi/kpi.service';
import { CurrentUser } from '../../common/decorators';
import { AuthUser } from '../../common/interfaces/auth-user.interface';

/**
 * FR-SRC-01 — global search by employee name, Employee ID, KPI name or KPI code.
 * Results stay inside the caller's data scope (§5.3) and are returned within 1 s.
 */
@Controller('search')
export class SearchController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly kpis: KpiService,
  ) {}

  @Get()
  async search(@CurrentUser() user: AuthUser, @Query('q') q?: string, @Query('limit') limit?: string) {
    const term = (q ?? '').trim();
    const take = Math.min(25, Math.max(5, Number(limit ?? 10)));
    if (term.length < 2) {
      return { query: term, employees: [], kpis: [] };
    }

    const employeeWhere = {
      AND: [
        this.scope.userScopeWhere(user),
        {
          OR: [
            { fullName: { contains: term, mode: 'insensitive' as const } },
            { employeeCode: { contains: term, mode: 'insensitive' as const } },
            { email: { contains: term, mode: 'insensitive' as const } },
          ],
        },
      ],
    };

    const canSeeOthers =
      user.permissions.includes('kpi:view-others') || this.scope.isGroupScoped(user);

    const [employees, kpis] = await Promise.all([
      canSeeOthers
        ? this.prisma.user.findMany({
            where: employeeWhere,
            take,
            orderBy: { fullName: 'asc' },
            select: {
              id: true,
              fullName: true,
              employeeCode: true,
              email: true,
              designationTitle: true,
              status: true,
              department: { select: { id: true, name: true } },
              businessUnit: { select: { id: true, name: true, code: true } },
              roles: { select: { role: { select: { code: true } } } },
            },
          })
        : Promise.resolve([]),
      this.kpis.searchByCodeOrName(term, user, take),
    ]);

    return {
      query: term,
      employees: employees.map((e) => ({
        id: e.id,
        fullName: e.fullName,
        employeeCode: e.employeeCode,
        email: e.email,
        designation: e.designationTitle ?? '—',
        department: e.department?.name ?? '—',
        businessUnit: e.businessUnit?.name ?? '—',
        roles: e.roles.map((r) => r.role.code),
        status: e.status,
      })),
      kpis: kpis.map((k) => ({
        id: k.id,
        code: k.code,
        name: k.name,
        status: k.status,
        employeeName: k.employee.fullName,
        employeeCode: k.employee.employeeCode,
        period: k.period.label,
      })),
    };
  }
}
