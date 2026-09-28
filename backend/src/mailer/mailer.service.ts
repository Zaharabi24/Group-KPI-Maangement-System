import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { renderEmail, TemplateContext } from './email.templates';

export interface SendMailOptions {
  to: string;
  cc?: string;
  templateCode: string;
  context: TemplateContext;
  /** Overrides the template subject when supplied (used by ad-hoc notices). */
  subjectOverride?: string;
}

/**
 * SMTP transport (NT-01 … NT-19). In development the default transport is
 * Mailpit on :1025, which captures every message without delivering it.
 * Delivery is performed by the BullMQ `email` worker with 3 retries (NFR-REL-01).
 */
@Injectable()
export class MailerService implements OnModuleInit {
  private readonly logger = new Logger(MailerService.name);
  private transporter: Transporter | null = null;

  onModuleInit(): void {
    if (String(process.env.MAIL_ENABLED ?? 'true') !== 'true') {
      this.logger.warn('E-mail delivery is disabled (MAIL_ENABLED=false). Messages are logged only.');
      return;
    }
    const transport = process.env.MAIL_TRANSPORT ?? 'smtp';

    if (transport === 'json') {
      this.transporter = nodemailer.createTransport({ jsonTransport: true });
    } else if (transport === 'stream') {
      this.transporter = nodemailer.createTransport({ streamTransport: true, newline: 'unix', buffer: true });
    } else {
      this.transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST ?? 'localhost',
        port: Number(process.env.SMTP_PORT ?? 1025),
        secure: String(process.env.SMTP_SECURE ?? 'false') === 'true',
        auth: process.env.SMTP_USER
          ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD ?? '' }
          : undefined,
        pool: true,
        maxConnections: 5,
        maxMessages: 100,
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 20_000,
        tls: { rejectUnauthorized: String(process.env.SMTP_TLS_REJECT_UNAUTHORIZED ?? 'true') === 'true' },
      });
    }

    this.logger.log(
      `Mailer ready (${transport} → ${process.env.SMTP_HOST ?? 'n/a'}:${process.env.SMTP_PORT ?? 'n/a'})`,
    );
  }

  /** Renders a template without sending — used by tests and the preview endpoint. */
  render(templateCode: string, context: TemplateContext) {
    return renderEmail(templateCode, context);
  }

  /** Performs the actual delivery; called from the queue worker. */
  async send(options: SendMailOptions): Promise<{ messageId: string }> {
    const rendered = renderEmail(options.templateCode, options.context);
    const subject = options.subjectOverride ?? rendered.subject;
    const fromName = process.env.MAIL_FROM_NAME ?? 'ANWAR KPIFlow';
    const fromAddress = process.env.MAIL_FROM_ADDRESS ?? 'no-reply@anwargroup.net';

    if (!this.transporter) {
      this.logger.log(`[mail-disabled] to=${options.to} subject="${subject}"`);
      return { messageId: `disabled-${Date.now()}` };
    }

    const info = await this.transporter.sendMail({
      from: `"${fromName}" <${fromAddress}>`,
      to: options.to,
      cc: options.cc,
      replyTo: process.env.MAIL_REPLY_TO,
      subject,
      html: rendered.html,
      text: rendered.text,
      headers: {
        'X-Entity-Ref-ID': `${options.templateCode}-${Date.now()}`,
        'X-Auto-Response-Suppress': 'OOF, AutoReply',
      },
    });

    return { messageId: info.messageId };
  }

  async verify(): Promise<boolean> {
    if (!this.transporter) return false;
    try {
      await this.transporter.verify();
      return true;
    } catch (e) {
      this.logger.warn(`SMTP verify failed: ${(e as Error).message}`);
      return false;
    }
  }
}
