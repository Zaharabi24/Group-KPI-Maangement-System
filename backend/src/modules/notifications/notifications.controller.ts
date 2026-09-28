import { Body, Controller, Get, HttpCode, HttpStatus, Patch, Post, Query } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { MailerService } from '../../mailer/mailer.service';
import { CurrentUser, Permissions, RequestMeta } from '../../common/decorators';
import { AuthUser, RequestContextMeta } from '../../common/interfaces/auth-user.interface';
import { PERM } from '../../common/constants';

@Controller('notifications')
export class NotificationsController {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly mailer: MailerService,
  ) {}

  /** FR-NTF-01 — the notification centre with the unread count. */
  @Get()
  async list(
    @CurrentUser() user: AuthUser,
    @Query('page') page?: string,
    @Query('size') size?: string,
    @Query('unreadOnly') unreadOnly?: string,
  ) {
    return this.notifications.list(user.id, {
      page: Math.max(1, Number(page ?? 1)),
      size: Math.min(100, Math.max(1, Number(size ?? 25))),
      unreadOnly: unreadOnly === 'true',
    });
  }

  @Get('unread-count')
  async unread(@CurrentUser() user: AuthUser) {
    return { unread: await this.notifications.unreadCount(user.id) };
  }

  @Patch('read')
  @HttpCode(HttpStatus.OK)
  async markRead(@CurrentUser() user: AuthUser, @Body() body: { ids: string[] }) {
    return { updated: await this.notifications.markRead(user.id, body.ids ?? []) };
  }

  @Post('read-all')
  @HttpCode(HttpStatus.OK)
  async markAll(@CurrentUser() user: AuthUser) {
    return { updated: await this.notifications.markAllRead(user.id) };
  }

  /** Template preview — helps QA verify the NT-01…NT-19 copy (§15). */
  @Post('preview')
  @Permissions(PERM.SYSTEM_SETTINGS)
  @HttpCode(HttpStatus.OK)
  preview(@Body() body: { templateCode: string; context?: Record<string, unknown> }, @RequestMeta() meta: RequestContextMeta) {
    void meta;
    return this.mailer.render(body.templateCode, {
      recipientName: 'Preview Recipient',
      appUrl: process.env.APP_URL,
      setupUrl: `${process.env.APP_URL ?? 'http://localhost:5173'}/set-password?token=preview-token`,
      resetUrl: `${process.env.APP_URL ?? 'http://localhost:5173'}/reset-password?token=preview-token`,
      ...(body.context ?? {}),
    });
  }
}
