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
import { TemplatesService } from './templates.service';
import {
  AssignTemplateDto,
  CreateTemplateDto,
  ListTemplatesQueryDto,
  PublishTemplateDto,
  UpdateTemplateDto,
} from './dto/templates.dto';
import {
  AnyPermission,
  CurrentUser,
  Permissions,
  RequestMeta,
} from '../../common/decorators';
import { AuthUser, RequestContextMeta } from '../../common/interfaces/auth-user.interface';
import { PERM } from '../../common/constants';

/**
 * KPI library — FR-LIB-01..05. Reading templates and categories is open to every
 * authenticated user (employees pick templates for their KPIs); management is
 * split between TEMPLATE_MANAGE (group) and TEMPLATE_DEPT_MANAGE (department).
 */
@Controller('kpi-library')
export class TemplatesController {
  constructor(private readonly templates: TemplatesService) {}

  @Get('templates')
  list(@Query() query: ListTemplatesQueryDto, @CurrentUser() user: AuthUser) {
    return this.templates.list(query, user);
  }

  @Get('templates/:id')
  get(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.templates.get(id, user);
  }

  @Post('templates')
  @AnyPermission(PERM.TEMPLATE_MANAGE, PERM.TEMPLATE_DEPT_MANAGE)
  @HttpCode(HttpStatus.CREATED)
  create(
    @Body() dto: CreateTemplateDto,
    @CurrentUser() user: AuthUser,
    @RequestMeta() meta: RequestContextMeta,
  ) {
    return this.templates.create(dto, user, meta);
  }

  /** FR-LIB-05 — editing creates a new template version. */
  @Patch('templates/:id')
  @AnyPermission(PERM.TEMPLATE_MANAGE, PERM.TEMPLATE_DEPT_MANAGE)
  update(
    @Param('id') id: string,
    @Body() dto: UpdateTemplateDto,
    @CurrentUser() user: AuthUser,
    @RequestMeta() meta: RequestContextMeta,
  ) {
    return this.templates.update(id, dto, user, meta);
  }

  @Post('templates/:id/publish')
  @Permissions(PERM.TEMPLATE_MANAGE)
  @HttpCode(HttpStatus.OK)
  publish(
    @Param('id') id: string,
    @Body() dto: PublishTemplateDto,
    @CurrentUser() user: AuthUser,
    @RequestMeta() meta: RequestContextMeta,
  ) {
    return this.templates.publish(id, dto.isPublished, user, meta);
  }

  /** FR-LIB-03 / UC-08 — bulk assignment to employees. */
  @Post('assignments')
  @Permissions(PERM.KPI_ASSIGN)
  @HttpCode(HttpStatus.CREATED)
  assign(
    @Body() dto: AssignTemplateDto,
    @CurrentUser() user: AuthUser,
    @RequestMeta() meta: RequestContextMeta,
  ) {
    return this.templates.assign(dto, user, meta);
  }

  @Get('categories')
  categories() {
    return this.templates.categories();
  }
}
