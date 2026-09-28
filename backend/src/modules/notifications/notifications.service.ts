import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { QueueService } from '../../queue/queue.service';
import { NotificationChannel } from '@prisma/client';

export interface NotifyRecipient {
  userId: string;
  email: string;
  fullName: string;
  emailDigest?: boolean;
}

export interface NotifyOptions {
  code: string; // NT-xx
  recipients: NotifyRecipient[];
  title: string;
  body: string;
  deepLink?: string;
  entityType?: string;
  entityId?: string;
  /** BOTH = in-app + e-mail (default), IN_APP = bell only, EMAIL = mail only. */
  channel?: NotificationChannel;
  severity?: 'info' | 'success' | 'warning' | 'danger';
  /** Context passed to the e-mail template renderer. */
  emailContext?: Record<string, unknown>;
  /** Critical events are always e-mailed (FR-PRF-05). */
  critical?: boolean;
}

/**
 * Notification centre + e-mail dispatch — BRD §15 (FR-NTF-01, FR-NTF-02).
 * Every event creates an in-app notification and, where the channel says so, an
 * e-mail delivered through the BullMQ queue with 3 retries.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
  ) {}

  async notify(options: NotifyOptions): Promise<void> {
    const channel = options.channel ?? NotificationChannel.BOTH;
    if (!options.recipients.length) return;

    const unique = new Map<string, NotifyRecipient>();
    options.recipients.forEach((r) => {
      if (r?.userId) unique.set(r.userId, r);
    });
    const recipients = Array.from(unique.values());
    if (!recipients.length) return;

    const rows: Prisma.NotificationCreateManyInput[] = recipients
      .filter(() => channel !== NotificationChannel.EMAIL)
      .map((r) => ({
        userId: r.userId,
        code: options.code,
        title: options.title,
        body: options.body,
        deepLink: options.deepLink ?? null,
        entityType: options.entityType ?? null,
        entityId: options.entityId ?? null,
        channel,
        severity: options.severity ?? 'info',
      }));

    if (rows.length) {
      await this.prisma.notification.createMany({ data: rows });
    }

    if (channel === NotificationChannel.IN_APP) return;

    const sendEmail = options.critical === true || channel === NotificationChannel.EMAIL || channel === NotificationChannel.BOTH;
    if (!sendEmail) return;

    for (const r of recipients) {
      const digestOnly = r.emailDigest === true && options.critical !== true;
      try {
        const log = await this.prisma.emailLog.create({
          data: {
            toEmail: r.email,
            subject: options.title,
            templateCode: options.code,
            payload: (options.emailContext ?? {}) as Prisma.InputJsonValue,
            status: 'QUEUED',
            userId: r.userId,
          },
        });

        await this.queue.enqueueEmail({
          emailLogId: log.id,
          to: r.email,
          templateCode: options.code,
          subjectOverride: options.title,
          context: {
            recipientName: r.fullName,
            ...(options.emailContext ?? {}),
          },
        });

        if (digestOnly) {
          this.logger.debug(`Non-critical e-mail queued for digest: ${options.code} → ${r.email}`);
        }
      } catch (e) {
        this.logger.error(`Notification e-mail failed for ${options.code} → ${r.email}: ${(e as Error).message}`);
      }
    }
  }

  /** In-app notification centre (FR-NTF-01) with unread count. */
  async list(userId: string, params: { page: number; size: number; unreadOnly?: boolean }) {
    const where: Prisma.NotificationWhereInput = { userId };
    if (params.unreadOnly) where.status = 'UNREAD';

    const [items, total, unread] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (params.page - 1) * params.size,
        take: params.size,
      }),
      this.prisma.notification.count({ where }),
      this.prisma.notification.count({ where: { userId, status: 'UNREAD' } }),
    ]);

    return {
      items,
      total,
      unread,
      page: params.page,
      size: params.size,
      totalPages: Math.max(1, Math.ceil(total / params.size)),
    };
  }

  async unreadCount(userId: string): Promise<number> {
    return this.prisma.notification.count({ where: { userId, status: 'UNREAD' } });
  }

  async markRead(userId: string, ids: string[]): Promise<number> {
    const res = await this.prisma.notification.updateMany({
      where: { userId, id: { in: ids }, status: 'UNREAD' },
      data: { status: 'READ', readAt: new Date() },
    });
    return res.count;
  }

  async markAllRead(userId: string): Promise<number> {
    const res = await this.prisma.notification.updateMany({
      where: { userId, status: 'UNREAD' },
      data: { status: 'READ', readAt: new Date() },
    });
    return res.count;
  }
}
