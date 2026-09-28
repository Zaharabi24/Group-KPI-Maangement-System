import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApprovalsService, DecisionDto } from './approvals.service';
import { AnyPermission, CurrentUser, Permissions, RequestMeta } from '../../common/decorators';
import { AuthUser, RequestContextMeta } from '../../common/interfaces/auth-user.interface';
import { PERM } from '../../common/constants';

@Controller()
export class ApprovalsController {
  constructor(private readonly approvals: ApprovalsService) {}

  /** FR-APR-01/02 — the KPI Pending Requests queue. */
  @Get('approvals')
  @Permissions(PERM.KPI_REVIEW)
  async queue(@CurrentUser() user: AuthUser, @Query() query: Record<string, string>) {
    return this.approvals.queue(user, query);
  }

  /** FR-APR-08 — Department Head KPI Requests (Super Admin). */
  @Get('approvals/department-heads')
  @Permissions(PERM.KPI_APPROVE_HEAD)
  async headQueue(@CurrentUser() user: AuthUser, @Query() query: Record<string, string>) {
    return this.approvals.departmentHeadQueue(user, query);
  }

  /** FR-APR-12 — All KPI Requests across the group (Super Admin). */
  @Get('approvals/all')
  @AnyPermission(PERM.KPI_APPROVE_HEAD, PERM.REPORT_VIEW_ALL)
  async allRequests(@CurrentUser() user: AuthUser, @Query() query: Record<string, string>) {
    return this.approvals.allRequests(user, query);
  }

  /** FR-APR-04 — opening a Submitted request sets it Under Review. */
  @Post('kpis/:id/review-start')
  @HttpCode(HttpStatus.OK)
  @Permissions(PERM.KPI_REVIEW)
  async startReview(@Param('id') id: string, @CurrentUser() user: AuthUser, @RequestMeta() meta: RequestContextMeta) {
    return this.approvals.startReview(id, user, meta);
  }

  /** FR-APR-03/05/06/07 — approve, adjust, return, reject or delete. */
  @Post('kpis/:id/decision')
  @HttpCode(HttpStatus.OK)
  @Permissions(PERM.KPI_REVIEW)
  async decide(
    @Param('id') id: string,
    @Body() dto: DecisionDto,
    @CurrentUser() user: AuthUser,
    @RequestMeta() meta: RequestContextMeta,
  ) {
    return this.approvals.decide(id, dto, user, meta);
  }

  /** FR-APR-11 — bulk approve up to 20 unadjusted requests. */
  @Post('approvals/bulk-approve')
  @HttpCode(HttpStatus.OK)
  @Permissions(PERM.KPI_REVIEW)
  async bulkApprove(
    @Body() dto: { ids: string[] },
    @CurrentUser() user: AuthUser,
    @RequestMeta() meta: RequestContextMeta,
  ) {
    return this.approvals.bulkApprove(dto.ids, user, meta);
  }

  /** UC-05 — the Escalations queue and its decision. */
  @Get('escalations')
  @Permissions(PERM.KPI_APPROVE_HEAD)
  async escalations(@CurrentUser() user: AuthUser, @Query() query: Record<string, string>) {
    return this.approvals.escalations(user, query);
  }

  @Post('escalations/:id/decision')
  @HttpCode(HttpStatus.OK)
  @Permissions(PERM.KPI_APPROVE_HEAD)
  async decideEscalation(
    @Param('id') id: string,
    @Body() dto: { decision: 'APPROVE' | 'DECLINE'; comment?: string },
    @CurrentUser() user: AuthUser,
    @RequestMeta() meta: RequestContextMeta,
  ) {
    return this.approvals.decideEscalation(id, dto.decision, dto.comment, user, meta);
  }

  /** Sidebar badge counts for every review-related queue. */
  @Get('approvals/counts')
  @AnyPermission(PERM.KPI_REVIEW, PERM.KPI_APPROVE_HEAD, PERM.KPI_APPROVE_CORRECTION)
  async counts(@CurrentUser() user: AuthUser) {
    return this.approvals.superAdminQueueCounts(user);
  }
}
