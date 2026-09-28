import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { KpiService } from './kpi.service';
import {
  CreateKpiDto,
  DeleteKpiDto,
  KpiListQueryDto,
  PreviewCalculationDto,
  RestoreVersionDto,
  UpdateKpiDto,
} from './dto/kpi.dto';
import { AnyPermission, CurrentUser, Permissions, Public, RequestMeta, SkipAudit } from '../../common/decorators';
import { AuthUser, RequestContextMeta } from '../../common/interfaces/auth-user.interface';
import { PERM } from '../../common/constants';
import { Forbidden, Unprocessable, ErrorCode } from '../../common/errors/error-codes';

const MAX_FILES = Number(process.env.EVIDENCE_MAX_FILES ?? 5);
const MAX_SIZE = Number(process.env.EVIDENCE_MAX_SIZE_MB ?? 10) * 1024 * 1024;

@Controller()
export class KpiController {
  constructor(private readonly kpi: KpiService) {}

  // ---------------------------------------------------------------- My KPI (M05)

  @Get('kpis')
  async list(@CurrentUser() user: AuthUser, @Query() query: KpiListQueryDto) {
    return this.kpi.myKpis(user, query);
  }

  @Post('kpis')
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() dto: CreateKpiDto, @CurrentUser() user: AuthUser, @RequestMeta() meta: RequestContextMeta) {
    return this.kpi.create(dto, user, meta);
  }

  @Get('kpis/:id')
  async detail(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.kpi.detail(id, user);
  }

  @Patch('kpis/:id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateKpiDto,
    @CurrentUser() user: AuthUser,
    @RequestMeta() meta: RequestContextMeta,
  ) {
    return this.kpi.update(id, dto, user, meta);
  }

  @Delete('kpis/:id')
  async remove(
    @Param('id') id: string,
    @Body() dto: DeleteKpiDto,
    @CurrentUser() user: AuthUser,
    @RequestMeta() meta: RequestContextMeta,
  ) {
    return this.kpi.remove(id, user, dto.reason, meta);
  }

  @Post('kpis/:id/submit')
  @HttpCode(HttpStatus.OK)
  async submit(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Headers('if-match') ifMatch: string | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @RequestMeta() meta: RequestContextMeta,
  ) {
    void idempotencyKey;
    return this.kpi.submit(id, user, ifMatch, meta);
  }

  @Post('kpis/:id/withdraw')
  @HttpCode(HttpStatus.OK)
  async withdraw(@Param('id') id: string, @CurrentUser() user: AuthUser, @RequestMeta() meta: RequestContextMeta) {
    return this.kpi.withdraw(id, user, meta);
  }

  @Post('kpis/:id/restore')
  @HttpCode(HttpStatus.OK)
  async restore(
    @Param('id') id: string,
    @Body() dto: DeleteKpiDto,
    @CurrentUser() user: AuthUser,
    @RequestMeta() meta: RequestContextMeta,
  ) {
    return this.kpi.restore(id, user, dto.reason, meta);
  }

  // ------------------------------------------------------------------ calculation

  @Post('kpis/preview-calculation')
  @HttpCode(HttpStatus.OK)
  async preview(@Body() dto: PreviewCalculationDto, @CurrentUser() user: AuthUser) {
    return this.kpi.preview(dto, user);
  }

  @Get('kpis/meta/weights')
  async weights(
    @CurrentUser() user: AuthUser,
    @Query('periodId') periodId: string,
    @Query('frequency') frequency: string,
    @Query('excludeKpiId') excludeKpiId?: string,
  ) {
    if (!periodId || !frequency) throw Unprocessable(ErrorCode.V_MISSING, 'periodId and frequency are required.');
    return this.kpi.weightAvailability(user, periodId, frequency, excludeKpiId);
  }

  @Get('kpis/meta/approvers')
  async approvers(@CurrentUser() user: AuthUser) {
    return this.kpi.approverOptions(user);
  }

  @Get('kpis/meta/categories')
  async categories() {
    return this.kpi.categories();
  }

  @Get('kpis/meta/reference')
  async reference() {
    return this.kpi.referenceData();
  }

  // -------------------------------------------------------------------- evidence

  @Post('kpis/:id/evidence')
  @UseInterceptors(FilesInterceptor('files', MAX_FILES, { limits: { fileSize: MAX_SIZE } }))
  async uploadEvidence(
    @Param('id') id: string,
    @UploadedFiles() files: Array<{ originalname: string; buffer: Buffer; size: number; mimetype: string }>,
    @CurrentUser() user: AuthUser,
    @RequestMeta() meta: RequestContextMeta,
  ) {
    if (!files?.length) throw Unprocessable(ErrorCode.FILE_REJECTED, 'Choose at least one file to upload.');
    const results: Array<{
      id: string;
      originalName: string;
      mimeType: string;
      sizeBytes: number;
      sha256: string;
      scanStatus: string;
      createdAt: Date;
    }> = [];
    for (const file of files) {
      results.push(await this.kpi.uploadEvidence(id, file, user, meta));
    }
    return { uploaded: results.length, files: results };
  }

  @Post('kpis/:id/evidence/:evidenceId/replace')
  @UseInterceptors(FilesInterceptor('file', 1, { limits: { fileSize: MAX_SIZE } }))
  async replaceEvidence(
    @Param('id') id: string,
    @Param('evidenceId') evidenceId: string,
    @UploadedFiles() files: Array<{ originalname: string; buffer: Buffer }>,
    @CurrentUser() user: AuthUser,
    @RequestMeta() meta: RequestContextMeta,
  ) {
    if (!files?.length) throw Unprocessable(ErrorCode.FILE_REJECTED, 'Choose a replacement file.');
    return this.kpi.replaceEvidence(id, evidenceId, files[0], user, meta);
  }

  @Delete('kpis/:id/evidence/:evidenceId')
  async removeEvidence(
    @Param('id') id: string,
    @Param('evidenceId') evidenceId: string,
    @CurrentUser() user: AuthUser,
    @RequestMeta() meta: RequestContextMeta,
  ) {
    return this.kpi.removeEvidence(id, evidenceId, user, meta);
  }

  @Get('evidence/:evidenceId/url')
  async evidenceUrl(
    @Param('evidenceId') evidenceId: string,
    @CurrentUser() user: AuthUser,
    @RequestMeta() meta: RequestContextMeta,
  ) {
    return this.kpi.evidenceUrl(evidenceId, user, meta);
  }

  /** Signed, time-limited stream — the token replaces the JWT (FR-EVD-04). */
  @Get('evidence/:evidenceId/download')
  @Public()
  @SkipAudit()
  async download(
    @Param('evidenceId') evidenceId: string,
    @Query('token') token: string,
    @Res() res: Response,
  ) {
    const { buffer, evidence } = await this.kpi.streamEvidence(evidenceId, token);
    res.setHeader('Content-Type', evidence.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(evidence.originalName)}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(buffer);
  }

  /** Inline preview for PDF and images (FR-EVD-05). */
  @Get('evidence/:evidenceId/preview')
  @Public()
  @SkipAudit()
  async preview1(
    @Param('evidenceId') evidenceId: string,
    @Query('token') token: string,
    @Res() res: Response,
  ) {
    const { buffer, evidence } = await this.kpi.streamEvidence(evidenceId, token);
    if (!['pdf', 'jpg', 'jpeg', 'png'].includes(evidence.extension)) {
      throw Forbidden('FORBIDDEN', 'This file type cannot be previewed inline.');
    }
    res.setHeader('Content-Type', evidence.mimeType);
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(evidence.originalName)}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(buffer);
  }

  // --------------------------------------------------------------------- versions

  @Get('kpis/:id/versions')
  async versions(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.kpi.versions(id, user);
  }

  @Get('kpis/:id/versions/:from/diff/:to')
  async diff(
    @Param('id') id: string,
    @Param('from') from: string,
    @Param('to') to: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.kpi.versionDiff(id, Number(from), Number(to), user);
  }

  @Post('kpis/:id/versions/restore')
  @HttpCode(HttpStatus.OK)
  @Permissions(PERM.VERSION_RESTORE)
  async restoreVersion(
    @Param('id') id: string,
    @Body() dto: RestoreVersionDto,
    @CurrentUser() user: AuthUser,
    @RequestMeta() meta: RequestContextMeta,
  ) {
    return this.kpi.restoreVersion(id, dto.versionNo, dto.reason, user, meta);
  }

  /** FR-KPI-10 — the detail report payload (calculation path, hashes, histories). */
  @Get('kpis/:id/report')
  async report(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.kpi.reportPayload(id, user);
  }

  // -------------------------------------------------------------------- corrections

  @Post('corrections')
  @HttpCode(HttpStatus.CREATED)
  @AnyPermission(PERM.KPI_APPROVE_CORRECTION, PERM.KPI_REVIEW)
  async requestCorrection(
    @Body() dto: { kpiId: string; reason: string; changes?: Record<string, unknown> },
    @CurrentUser() user: AuthUser,
    @RequestMeta() meta: RequestContextMeta,
  ) {
    return this.kpi.requestCorrection(dto, user, meta);
  }

  @Post('corrections/:id/decision')
  @HttpCode(HttpStatus.OK)
  @Permissions(PERM.KPI_APPROVE_CORRECTION)
  async decideCorrection(
    @Param('id') id: string,
    @Body() dto: { decision: 'APPROVE' | 'DECLINE'; comment?: string },
    @CurrentUser() user: AuthUser,
    @RequestMeta() meta: RequestContextMeta,
  ) {
    return this.kpi.decideCorrection(id, dto.decision, dto.comment, user, meta);
  }

  @Get('corrections')
  @AnyPermission(PERM.KPI_APPROVE_CORRECTION, PERM.KPI_REVIEW, PERM.KPI_VIEW_OTHERS)
  async corrections(@CurrentUser() user: AuthUser, @Query('status') status?: string) {
    return this.kpi.listCorrections(user, status);
  }

  /** FR-DHD-02 — every dashboard card opens its filtered list. */
  @Get('kpis/drill-down/:kind')
  @AnyPermission(PERM.DASHBOARD_DEPT, PERM.DASHBOARD_GROUP, PERM.KPI_VIEW_OTHERS)
  async drillDown(
    @Param('kind') kind: string,
    @CurrentUser() user: AuthUser,
    @Query() query: Record<string, string>,
  ) {
    return this.kpi.drillDown(
      user,
      {
        periodId: query.periodId,
        departmentId: query.departmentId,
        businessUnitId: query.businessUnitId,
        kind: kind as never,
      },
      Math.max(1, Number(query.page ?? 1)),
      Math.min(100, Math.max(1, Number(query.size ?? 25))),
    );
  }
}
