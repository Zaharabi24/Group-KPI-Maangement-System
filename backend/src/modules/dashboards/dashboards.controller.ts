import { Controller, Get, Param, Query } from '@nestjs/common';
import { DashboardsService } from './dashboards.service';
import { AnyPermission, CurrentUser, Permissions } from '../../common/decorators';
import { AuthUser } from '../../common/interfaces/auth-user.interface';
import { PERM } from '../../common/constants';

@Controller('dashboard')
export class DashboardsController {
  constructor(private readonly dashboards: DashboardsService) {}

  /** FR-PSM-01..04 / UC-06 — the employee Performance Summary. */
  @Get('employee')
  async employee(@CurrentUser() user: AuthUser, @Query() query: Record<string, string>) {
    return this.dashboards.employeeSummary(user, query);
  }

  /** FR-DHD-01..03 / UC-11 — the Department Dashboard. */
  @Get('department')
  @AnyPermission(PERM.DASHBOARD_DEPT, PERM.DASHBOARD_GROUP)
  async department(@CurrentUser() user: AuthUser, @Query() query: Record<string, string>) {
    return this.dashboards.departmentDashboard(user, query);
  }

  /** FR-SAD-01 / US-19 — the Group Dashboard. */
  @Get('group')
  @Permissions(PERM.DASHBOARD_GROUP)
  async group(@CurrentUser() user: AuthUser, @Query() query: Record<string, string>) {
    return this.dashboards.groupDashboard(user, query);
  }

  /** Drill-down BU → Department → Employee → KPI. */
  @Get('drill-down')
  @AnyPermission(PERM.DASHBOARD_GROUP, PERM.DASHBOARD_DEPT)
  async drillDown(@CurrentUser() user: AuthUser, @Query() query: Record<string, string>) {
    return this.dashboards.drillDown(user, query);
  }

  /** Sidebar-friendly shortcut endpoints used by the dashboards. */
  @Get('department/:id')
  @AnyPermission(PERM.DASHBOARD_DEPT, PERM.DASHBOARD_GROUP)
  async departmentById(@Param('id') id: string, @CurrentUser() user: AuthUser, @Query() query: Record<string, string>) {
    return this.dashboards.departmentDashboard(user, { ...query, departmentId: id });
  }
}

@Controller('leaderboard')
export class LeaderboardController {
  constructor(private readonly dashboards: DashboardsService) {}

  /** FR-DHD-03 — ranked leaderboard with RAG bars. */
  @Get()
  @AnyPermission(PERM.DASHBOARD_DEPT, PERM.DASHBOARD_GROUP)
  async leaderboard(@CurrentUser() user: AuthUser, @Query() query: Record<string, string>) {
    return this.dashboards.leaderboard(user, query);
  }
}
