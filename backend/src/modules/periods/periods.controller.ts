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
import { PeriodsService } from './periods.service';
import {
  ClosePeriodDto,
  CurrentPeriodQueryDto,
  EnsureCalendarDto,
  GrantExtensionDto,
  ListExtensionsQueryDto,
  ListPeriodsQueryDto,
  ReopenPeriodDto,
  UpsertPeriodDto,
} from './dto/periods.dto';
import {
  AnyPermission,
  CurrentUser,
  Permissions,
  RequestMeta,
} from '../../common/decorators';
import { AuthUser, RequestContextMeta } from '../../common/interfaces/auth-user.interface';
import { PERM } from '../../common/constants';

/**
 * Period administration — FR-CFG-01, FR-CFG-03, FR-CFG-04.
 * The list endpoint is readable by every role that shows a dashboard so the
 * global period picker works for all users.
 */
@Controller('admin/periods')
export class PeriodsController {
  constructor(private readonly periods: PeriodsService) {}

  /** Everyone with a dashboard (or period admin) needs the period picker. */
  @Get()
  @AnyPermission(
    PERM.PERIOD_MANAGE,
    PERM.DASHBOARD_DEPT,
    PERM.DASHBOARD_GROUP,
    PERM.KPI_VIEW_OTHERS,
  )
  list(@Query() query: ListPeriodsQueryDto) {
    return this.periods.list(query);
  }

  /** Current period for the selector — any authenticated user. */
  @Get('current')
  current(@Query() query: CurrentPeriodQueryDto) {
    return this.periods.current(query.frequency);
  }

  /** FR-CFG-01 — generate the calendar for a year. */
  @Post('calendar')
  @Permissions(PERM.PERIOD_MANAGE)
  @HttpCode(HttpStatus.OK)
  calendar(
    @Body() dto: EnsureCalendarDto,
    @CurrentUser() user: AuthUser,
    @RequestMeta() meta: RequestContextMeta,
  ) {
    return this.periods.ensureCalendar(dto.year, dto.frequencies, user, meta);
  }

  /** FR-CFG-01 — manual creation. */
  @Post()
  @Permissions(PERM.PERIOD_MANAGE)
  @HttpCode(HttpStatus.CREATED)
  create(
    @Body() dto: UpsertPeriodDto,
    @CurrentUser() user: AuthUser,
    @RequestMeta() meta: RequestContextMeta,
  ) {
    return this.periods.createOrUpdate(dto, user, meta);
  }

  /** Manual maintenance of deadlines / status. */
  @Patch(':id')
  @Permissions(PERM.PERIOD_MANAGE)
  update(
    @Param('id') id: string,
    @Body() dto: UpsertPeriodDto,
    @CurrentUser() user: AuthUser,
    @RequestMeta() meta: RequestContextMeta,
  ) {
    return this.periods.createOrUpdate({ ...dto, id }, user, meta);
  }

  /** FR-CFG-03 — close the period (blocked by pending items). */
  @Post(':id/close')
  @Permissions(PERM.PERIOD_MANAGE)
  @HttpCode(HttpStatus.OK)
  close(
    @Param('id') id: string,
    @Body() dto: ClosePeriodDto,
    @CurrentUser() user: AuthUser,
    @RequestMeta() meta: RequestContextMeta,
  ) {
    return this.periods.close(id, dto, user, meta);
  }

  /** FR-CFG-03 / BR-R12 — reopen a closed period for corrections. */
  @Post(':id/reopen')
  @Permissions(PERM.PERIOD_MANAGE)
  @HttpCode(HttpStatus.OK)
  reopen(
    @Param('id') id: string,
    @Body() dto: ReopenPeriodDto,
    @CurrentUser() user: AuthUser,
    @RequestMeta() meta: RequestContextMeta,
  ) {
    return this.periods.reopen(id, dto.reason, user, meta);
  }

  /** Close-dialog checklist: pending, not submitted and weight-incomplete employees. */
  @Get(':id/outstanding')
  @Permissions(PERM.PERIOD_MANAGE)
  outstanding(@Param('id') id: string) {
    return this.periods.outstanding(id);
  }

  /** FR-CFG-04 / EC-09 — grant an extension on a single KPI. */
  @Post('extensions')
  @AnyPermission(PERM.PERIOD_MANAGE, PERM.EXTENSION_GRANT)
  @HttpCode(HttpStatus.CREATED)
  grantExtension(
    @Body() dto: GrantExtensionDto,
    @CurrentUser() user: AuthUser,
    @RequestMeta() meta: RequestContextMeta,
  ) {
    return this.periods.grantExtension(dto.kpiId, dto, user, meta);
  }

  /** Extension history. */
  @Get('extensions')
  @Permissions(PERM.PERIOD_MANAGE)
  extensions(@Query() query: ListExtensionsQueryDto) {
    return this.periods.listExtensions(query.periodId, query);
  }
}

/**
 * `/periods/selectable` — the UI period picker. Any authenticated user, because
 * employees, approvers and viewers all need to choose a period.
 */
@Controller('periods')
export class PeriodsSelectableController {
  constructor(private readonly periods: PeriodsService) {}

  @Get('selectable')
  selectable() {
    return this.periods.selectable();
  }
}
