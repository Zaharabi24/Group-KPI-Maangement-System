import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ConfigurationService } from './configuration.service';
import { PublishConfigurationDto, RecalculateConfigurationDto } from './dto/configuration.dto';
import { AnyPermission, CurrentUser, Permissions, RequestMeta } from '../../common/decorators';
import { AuthUser, RequestContextMeta } from '../../common/interfaces/auth-user.interface';
import { PERM } from '../../common/constants';

/**
 * Configuration versions — FR-CFG-02, §4.9.
 * The active configuration is readable by any authenticated user (the UI shows
 * the effective score cap / adjustment band); publishing and recalculation are
 * restricted to CONFIG_MANAGE (Super Admin).
 */
@Controller('admin/configuration-versions')
export class ConfigurationController {
  constructor(private readonly configuration: ConfigurationService) {}

  @Get()
  @AnyPermission(PERM.CONFIG_MANAGE, PERM.SYSTEM_SETTINGS)
  list() {
    return this.configuration.list();
  }

  /** Effective cap / band for the UI — any authenticated user. */
  @Get('active')
  active() {
    return this.configuration.active();
  }

  @Post()
  @Permissions(PERM.CONFIG_MANAGE)
  @HttpCode(HttpStatus.CREATED)
  publish(
    @Body() dto: PublishConfigurationDto,
    @CurrentUser() user: AuthUser,
    @RequestMeta() meta: RequestContextMeta,
  ) {
    return this.configuration.publish(dto, user, meta);
  }

  /** §4.9 — recalculate an open period with the active configuration. */
  @Post('recalculate')
  @Permissions(PERM.CONFIG_MANAGE)
  @HttpCode(HttpStatus.OK)
  recalculate(
    @Body() dto: RecalculateConfigurationDto,
    @CurrentUser() user: AuthUser,
    @RequestMeta() meta: RequestContextMeta,
  ) {
    return this.configuration.recalculate(dto.periodId, dto.reason, user, meta);
  }
}
