/**
 * E-mail templates for NT-01 … NT-19 (BRD §15).
 * E-mails deep-link to the record and never contain evidence files or passwords.
 * Rendering is inline (no view engine dependency) so the templates travel with
 * the compiled bundle.
 */
import { NT } from '../common/constants';

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export interface TemplateContext {
  appName?: string;
  appUrl?: string;
  recipientName?: string;
  [key: string]: unknown;
}

const BRAND_NAVY = '#0B2545';
const BRAND_BLUE = '#1F4E79';

const esc = (value: unknown): string =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const layout = (ctx: TemplateContext, heading: string, body: string, cta?: { label: string; url: string }): string => {
  const appName = esc(ctx.appName ?? 'ANWAR KPIFlow');
  const appUrl = ctx.appUrl ?? 'http://localhost:5173';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(heading)}</title></head>
<body style="margin:0;padding:0;background:#F5F7FA;font-family:'Inter','Segoe UI',system-ui,-apple-system,sans-serif;color:#1A1A1A;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F5F7FA;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#FFFFFF;border:1px solid #D9E1EA;border-radius:12px;overflow:hidden;">
        <tr><td style="background:${BRAND_NAVY};padding:20px 28px;">
          <div style="color:#FFFFFF;font-size:18px;font-weight:600;letter-spacing:.4px;">ANWAR KPI</div>
          <div style="color:#C9D6E4;font-size:12px;margin-top:2px;">${appName} · Variable KPI &amp; Performance Management</div>
        </td></tr>
        <tr><td style="padding:28px;">
          <h1 style="margin:0 0 12px;font-size:20px;line-height:28px;color:${BRAND_NAVY};font-weight:600;">${esc(heading)}</h1>
          <div style="font-size:14px;line-height:22px;color:#1A1A1A;">${body}</div>
          ${
            cta
              ? `<div style="margin-top:24px;"><a href="${esc(cta.url)}" style="display:inline-block;background:${BRAND_NAVY};color:#FFFFFF;text-decoration:none;padding:12px 20px;border-radius:8px;font-size:14px;font-weight:600;">${esc(cta.label)}</a></div>
                 <div style="margin-top:12px;font-size:12px;color:#5B6770;word-break:break-all;">${esc(cta.url)}</div>`
              : ''
          }
        </td></tr>
        <tr><td style="padding:16px 28px;background:#F5F7FA;border-top:1px solid #D9E1EA;font-size:12px;color:#5B6770;">
          This message was sent automatically by ${appName}. Do not reply to it.
          <br>If you were not expecting it, contact Group HR or Group IT.
        </td></tr>
      </table>
      <div style="max-width:600px;margin-top:10px;font-size:11px;color:#8A96A1;">© ${new Date().getFullYear()} Anwar Group of Industries · Internal &amp; Confidential</div>
    </td></tr>
  </table>
</body></html>`;
};

const textOf = (heading: string, lines: string[], cta?: { label: string; url: string }): string =>
  [heading, '', ...lines, ...(cta ? ['', `${cta.label}: ${cta.url}`] : []), '', '— ANWAR KPIFlow (automated message)'].join('\n');

const p = (text: string) => `<p style="margin:0 0 10px;">${text}</p>`;
const kv = (rows: Array<[string, unknown]>) =>
  `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:12px 0;border-collapse:collapse;width:100%;">
     ${rows
       .map(
         ([k, v], i) =>
           `<tr><td style="padding:6px 10px;background:${i % 2 ? '#FFFFFF' : '#F5F7FA'};border:1px solid #D9E1EA;font-size:13px;color:#5B6770;width:42%;">${esc(k)}</td>
                <td style="padding:6px 10px;background:${i % 2 ? '#FFFFFF' : '#F5F7FA'};border:1px solid #D9E1EA;font-size:13px;color:#1A1A1A;font-weight:600;">${esc(v)}</td></tr>`,
       )
       .join('')}
   </table>`;

const greeting = (ctx: TemplateContext) => (ctx.recipientName ? p(`Dear ${esc(ctx.recipientName)},`) : '');

export type TemplateRenderer = (ctx: TemplateContext) => RenderedEmail;

export const EMAIL_TEMPLATES: Record<string, TemplateRenderer> = {
  [NT.REGISTRATION_SUBMITTED]: (ctx) => {
    const url = String(ctx.setupUrl);
    return {
      subject: 'Set up your ANWAR KPIFlow password',
      html: layout(
        ctx,
        'Welcome to ANWAR KPIFlow',
        greeting(ctx) +
          p('Your account has been created. Use the button below to choose your password and activate access.') +
          p('This single-use link is valid for <strong>24 hours</strong>.'),
        { label: 'Set my password', url },
      ),
      text: textOf('Welcome to ANWAR KPIFlow', ['Your account has been created.', 'The link is valid for 24 hours.'], {
        label: 'Set my password',
        url,
      }),
    };
  },

  [NT.INVITATION_CREATED]: (ctx) => {
    const url = String(ctx.setupUrl);
    return {
      subject: `You are invited to ANWAR KPIFlow as ${ctx.roleLabel ?? 'a user'}`,
      html: layout(
        ctx,
        'You have been invited to ANWAR KPIFlow',
        greeting(ctx) +
          p('A role has been assigned to you on the group KPI platform.') +
          kv([
            ['Role', ctx.roleLabel ?? '—'],
            ['Business Unit', ctx.businessUnit ?? '—'],
            ['Department', ctx.department ?? '—'],
          ]) +
          p('This single-use link is valid for <strong>72 hours</strong>.'),
        { label: 'Set my password', url },
      ),
      text: textOf(
        'You have been invited to ANWAR KPIFlow',
        [
          `Role: ${ctx.roleLabel ?? '-'}`,
          `Business Unit: ${ctx.businessUnit ?? '-'}`,
          `Department: ${ctx.department ?? '-'}`,
          'The link is valid for 72 hours.',
        ],
        { label: 'Set my password', url },
      ),
    };
  },

  [NT.PASSWORD_RESET_OR_LOCKOUT]: (ctx) => {
    const url = ctx.resetUrl ? String(ctx.resetUrl) : null;
    const heading = url ? 'Reset your ANWAR KPIFlow password' : 'Your account has been temporarily locked';
    const body = url
      ? greeting(ctx) + p('Use the button below to choose a new password.') + p('The link is valid for <strong>30 minutes</strong> and can be used once. All other sessions will be signed out.')
      : greeting(ctx) +
        p('Five consecutive failed sign-in attempts were recorded, so the account is locked for <strong>15 minutes</strong>.') +
        (ctx.lockedUntil ? kv([['Locked until', ctx.lockedUntil]]) : '') +
        p('If this was not you, reset your password or contact Group IT.');
    return {
      subject: heading,
      html: layout(ctx, heading, body, url ? { label: 'Choose a new password', url } : undefined),
      text: textOf(heading, url ? ['The link is valid for 30 minutes.'] : ['Locked for 15 minutes.'], url ? { label: 'Choose a new password', url } : undefined),
    };
  },

  [NT.KPI_ASSIGNED]: (ctx) => {
    const url = String(ctx.kpiUrl);
    return {
      subject: `A KPI has been assigned to you: ${ctx.kpiName}`,
      html: layout(
        ctx,
        'A KPI has been assigned to you',
        greeting(ctx) +
          p('Your Department Head assigned a KPI for the selected period. Add your actual result, evidence and remarks, then submit.') +
          kv([
            ['KPI', ctx.kpiName],
            ['Period', ctx.period],
            ['Target', ctx.target],
            ['KPI Weight', ctx.weight],
            ['Deadline', ctx.deadline],
          ]),
        { label: 'Complete this KPI', url },
      ),
      text: textOf(
        'A KPI has been assigned to you',
        [`KPI: ${ctx.kpiName}`, `Period: ${ctx.period}`, `Target: ${ctx.target}`, `Weight: ${ctx.weight}`, `Deadline: ${ctx.deadline}`],
        { label: 'Complete this KPI', url },
      ),
    };
  },

  [NT.KPI_SUBMITTED]: (ctx) => {
    const url = String(ctx.reviewUrl);
    return {
      subject: `KPI submitted for your review: ${ctx.employeeName} · ${ctx.kpiName}`,
      html: layout(
        ctx,
        'A KPI is waiting for your review',
        greeting(ctx) +
          p('An employee submitted a KPI that names you as the approver.') +
          kv([
            ['Employee', `${ctx.employeeName} (${ctx.employeeCode})`],
            ['KPI', ctx.kpiName],
            ['Period', ctx.period],
            ['Achievement', ctx.achievement],
            ['KPI Weight', ctx.weight],
            ['Submitted', ctx.submittedAt],
          ]),
        { label: 'View request', url },
      ),
      text: textOf(
        'A KPI is waiting for your review',
        [`Employee: ${ctx.employeeName} (${ctx.employeeCode})`, `KPI: ${ctx.kpiName}`, `Period: ${ctx.period}`, `Achievement: ${ctx.achievement}`],
        { label: 'View request', url },
      ),
    };
  },

  [NT.REVIEW_STARTED]: (ctx) => {
    const url = String(ctx.kpiUrl);
    return {
      subject: `Your KPI is under review: ${ctx.kpiName}`,
      html: layout(
        ctx,
        'Your KPI is now under review',
        greeting(ctx) +
          p(`<strong>${esc(ctx.approverName)}</strong> opened your KPI. Withdrawal is no longer possible.`) +
          kv([
            ['KPI', ctx.kpiName],
            ['Period', ctx.period],
            ['Status', 'Under Review'],
          ]),
        { label: 'Open my KPI', url },
      ),
      text: textOf('Your KPI is now under review', [`KPI: ${ctx.kpiName}`, `Approver: ${ctx.approverName}`], { label: 'Open my KPI', url }),
    };
  },

  [NT.KPI_APPROVED]: (ctx) => {
    const url = String(ctx.kpiUrl);
    return {
      subject: `Your KPI was approved: ${ctx.kpiName}`,
      html: layout(
        ctx,
        'Your KPI has been approved',
        greeting(ctx) +
          p('Your final score is confirmed.') +
          kv([
            ['KPI', ctx.kpiName],
            ['Period', ctx.period],
            ['Achievement', ctx.achievement],
            ['Final Score', ctx.finalScore],
            ['KPI Weight', ctx.weight],
            ['Weighted Score', ctx.weightedScore],
          ]),
        { label: 'Open my KPI', url },
      ),
      text: textOf(
        'Your KPI has been approved',
        [`KPI: ${ctx.kpiName}`, `Achievement: ${ctx.achievement}`, `Final Score: ${ctx.finalScore}`, `Weighted Score: ${ctx.weightedScore}`],
        { label: 'Open my KPI', url },
      ),
    };
  },

  [NT.KPI_APPROVED_WITH_ADJUSTMENT]: (ctx) => {
    const url = String(ctx.kpiUrl);
    return {
      subject: `Your KPI was approved with an adjustment: ${ctx.kpiName}`,
      html: layout(
        ctx,
        'Your KPI was approved with an adjustment',
        greeting(ctx) +
          p('The approver changed one or more values before approving. The before/after record is on the Adjustment History panel.') +
          kv([
            ['KPI', ctx.kpiName],
            ['Period', ctx.period],
            ['Calculated Score (as submitted)', ctx.calculatedScore],
            ['Adjusted Final Score', ctx.finalScore],
            ['Reason', ctx.reason],
            ['Decided by', ctx.approverName],
          ]),
        { label: 'See what changed', url },
      ),
      text: textOf(
        'Your KPI was approved with an adjustment',
        [`KPI: ${ctx.kpiName}`, `Calculated: ${ctx.calculatedScore}`, `Adjusted: ${ctx.finalScore}`, `Reason: ${ctx.reason}`],
        { label: 'See what changed', url },
      ),
    };
  },

  [NT.KPI_RETURNED]: (ctx) => {
    const url = String(ctx.kpiUrl);
    return {
      subject: `Your KPI was returned for correction: ${ctx.kpiName}`,
      html: layout(
        ctx,
        'Your KPI needs a correction',
        greeting(ctx) +
          p('Your approver returned the KPI with a comment. Edit and resubmit within the resubmission window.') +
          kv([
            ['KPI', ctx.kpiName],
            ['Period', ctx.period],
            ['Approver comment', ctx.comment],
            ['Resubmit by', ctx.resubmitBy],
          ]),
        { label: 'Edit and resubmit', url },
      ),
      text: textOf(
        'Your KPI needs a correction',
        [`KPI: ${ctx.kpiName}`, `Comment: ${ctx.comment}`, `Resubmit by: ${ctx.resubmitBy}`],
        { label: 'Edit and resubmit', url },
      ),
    };
  },

  [NT.KPI_REJECTED]: (ctx) => {
    const url = String(ctx.kpiUrl);
    return {
      subject: `Your KPI was rejected: ${ctx.kpiName}`,
      html: layout(
        ctx,
        'Your KPI was rejected',
        greeting(ctx) +
          p('The KPI was not accepted. Its weight has been released, and you may create a replacement before the deadline.') +
          kv([
            ['KPI', ctx.kpiName],
            ['Period', ctx.period],
            ['Reason category', ctx.rejectCategory],
            ['Comment', ctx.comment],
          ]),
        { label: 'Open my KPI', url },
      ),
      text: textOf(
        'Your KPI was rejected',
        [`KPI: ${ctx.kpiName}`, `Category: ${ctx.rejectCategory}`, `Comment: ${ctx.comment}`],
        { label: 'Open my KPI', url },
      ),
    };
  },

  [NT.ADJUSTMENT_ESCALATED]: (ctx) => {
    const url = String(ctx.escalationUrl);
    return {
      subject: `Escalation: adjustment outside the ±${ctx.band} band on ${ctx.kpiName}`,
      html: layout(
        ctx,
        'An adjustment needs Super Admin approval',
        greeting(ctx) +
          p('A Department Head applied a score adjustment outside the configured band.') +
          kv([
            ['Employee', `${ctx.employeeName} (${ctx.employeeCode})`],
            ['KPI', ctx.kpiName],
            ['Department', ctx.department],
            ['Calculated Score', ctx.calculatedScore],
            ['Proposed Final Score', ctx.proposedScore],
            ['Δ (delta)', ctx.delta],
            ['Reason', ctx.reason],
          ]),
        { label: 'Open Escalations', url },
      ),
      text: textOf(
        'An adjustment needs Super Admin approval',
        [`KPI: ${ctx.kpiName}`, `Calculated: ${ctx.calculatedScore}`, `Proposed: ${ctx.proposedScore}`, `Delta: ${ctx.delta}`, `Reason: ${ctx.reason}`],
        { label: 'Open Escalations', url },
      ),
    };
  },

  [NT.ESCALATION_DECIDED]: (ctx) => {
    const url = String(ctx.kpiUrl);
    return {
      subject: `Escalation decided: ${ctx.outcome} — ${ctx.kpiName}`,
      html: layout(
        ctx,
        `Escalation ${ctx.outcome}`,
        greeting(ctx) +
          kv([
            ['KPI', ctx.kpiName],
            ['Employee', ctx.employeeName],
            ['Outcome', ctx.outcome],
            ['Final Score', ctx.finalScore],
            ['Comment', ctx.comment],
          ]),
        { label: 'Open the KPI', url },
      ),
      text: textOf('Escalation decided', [`KPI: ${ctx.kpiName}`, `Outcome: ${ctx.outcome}`, `Final Score: ${ctx.finalScore}`], {
        label: 'Open the KPI',
        url,
      }),
    };
  },

  [NT.DEADLINE_APPROACHING]: (ctx) => {
    const url = String(ctx.myKpiUrl);
    const rows = (ctx.items as Array<Record<string, string>>) ?? [];
    return {
      subject: `Reminder: ${ctx.daysLeft} day(s) left to submit your KPIs`,
      html: layout(
        ctx,
        'Your KPI submission deadline is approaching',
        greeting(ctx) +
          p(`You have <strong>${esc(ctx.daysLeft)}</strong> day(s) left in the ${esc(ctx.period)} submission window.`) +
          (rows.length ? kv(rows.map((r) => [r.label, r.value] as [string, unknown])) : '') +
          p('Open My KPI to complete drafts, resubmit returned items or allocate any remaining weight.'),
        { label: 'Open My KPI', url },
      ),
      text: textOf(
        'Your KPI submission deadline is approaching',
        [`Days left: ${ctx.daysLeft}`, ...rows.map((r) => `${r.label}: ${r.value}`)],
        { label: 'Open My KPI', url },
      ),
    };
  },

  [NT.DEADLINE_MISSED]: (ctx) => {
    const url = String(ctx.myKpiUrl);
    return {
      subject: `Submission deadline missed for ${ctx.period}`,
      html: layout(
        ctx,
        'The submission deadline has passed',
        greeting(ctx) +
          p('The following KPIs were set to <strong>Not Submitted</strong> and score 0. An extension of up to 7 days may be granted by your Department Head, with a reason.') +
          kv([['Period', ctx.period], ['KPIs', ctx.kpiList], ['Route to extension', 'My KPI → request extension']]),
        { label: 'Open My KPI', url },
      ),
      text: textOf('The submission deadline has passed', [`Period: ${ctx.period}`, `KPIs: ${ctx.kpiList}`], {
        label: 'Open My KPI',
        url,
      }),
    };
  },

  [NT.REVIEW_SLA_BREACHED]: (ctx) => {
    const url = String(ctx.queueUrl);
    return {
      subject: `Review SLA breached: ${ctx.pendingCount} request(s) waiting ${ctx.ageDays} working days`,
      html: layout(
        ctx,
        'Review SLA breached',
        greeting(ctx) +
          p('The review SLA of 5 working days has been breached on the requests below.') +
          kv([
            ['Pending requests', ctx.pendingCount],
            ['Oldest age (working days)', ctx.ageDays],
            ['Escalates to Super Admin at', '8 working days'],
          ]),
        { label: 'Open KPI Pending Requests', url },
      ),
      text: textOf('Review SLA breached', [`Pending: ${ctx.pendingCount}`, `Oldest age: ${ctx.ageDays}`], {
        label: 'Open KPI Pending Requests',
        url,
      }),
    };
  },

  [NT.PERIOD_CLOSED]: (ctx) => {
    const url = String(ctx.summaryUrl);
    return {
      subject: `Results published for ${ctx.period}`,
      html: layout(
        ctx,
        `${ctx.period} has been closed — your results are final`,
        greeting(ctx) +
          p('The period was closed by a Super Admin. Every KPI in it is now locked and the results below are final.') +
          kv([
            ['Total KPI Score', ctx.totalKpiScore],
            ['Average Achievement', ctx.averageAchievement],
            ['Allocated Weight', ctx.allocatedWeight],
            ['Approved KPIs', ctx.approvedCount],
            ['RAG status', ctx.rag],
            ['Rank', ctx.rank],
          ]),
        { label: 'Open Performance Summary', url },
      ),
      text: textOf(
        `${ctx.period} has been closed`,
        [`Total KPI Score: ${ctx.totalKpiScore}`, `Average Achievement: ${ctx.averageAchievement}`, `Rank: ${ctx.rank}`],
        { label: 'Open Performance Summary', url },
      ),
    };
  },

  [NT.KPI_DELETED]: (ctx) => {
    const url = String(ctx.kpiUrl);
    return {
      subject: `Your KPI was removed: ${ctx.kpiName}`,
      html: layout(
        ctx,
        'A KPI was removed by your approver',
        greeting(ctx) +
          p('The KPI was soft-deleted and its weight released. The record is restorable by a Super Admin.') +
          kv([
            ['KPI', ctx.kpiName],
            ['Period', ctx.period],
            ['Reason', ctx.reason],
          ]),
        { label: 'Open my KPI', url },
      ),
      text: textOf('A KPI was removed by your approver', [`KPI: ${ctx.kpiName}`, `Reason: ${ctx.reason}`], {
        label: 'Open my KPI',
        url,
      }),
    };
  },

  [NT.CORRECTION_OR_REOPEN]: (ctx) => {
    const url = String(ctx.linkUrl ?? ctx.appUrl);
    return {
      subject: `${ctx.eventTitle}: ${ctx.subject}`,
      html: layout(
        ctx,
        String(ctx.eventTitle),
        greeting(ctx) +
          p(String(ctx.detail)) +
          (ctx.rows ? kv(ctx.rows as Array<[string, unknown]>) : ''),
        { label: String(ctx.ctaLabel ?? 'Open ANWAR KPIFlow'), url },
      ),
      text: textOf(String(ctx.eventTitle), [String(ctx.detail)], { label: String(ctx.ctaLabel ?? 'Open'), url }),
    };
  },

  [NT.KPI_INPUTS_EDITED]: (ctx) => {
    const url = String(ctx.kpiUrl);
    return {
      subject: `Your KPI inputs were updated during review: ${ctx.kpiName}`,
      html: layout(
        ctx,
        'Your KPI inputs were updated during review',
        greeting(ctx) +
          p('Your approver changed one or more inputs while reviewing the KPI. The score has been recalculated.') +
          kv([
            ['KPI', ctx.kpiName],
            ['Changes', ctx.changeSummary],
            ['Updated by', ctx.approverName],
          ]),
        { label: 'See the changes', url },
      ),
      text: textOf(
        'Your KPI inputs were updated during review',
        [`KPI: ${ctx.kpiName}`, `Changes: ${ctx.changeSummary}`],
        { label: 'See the changes', url },
      ),
    };
  },
};

export const renderEmail = (templateCode: string, ctx: TemplateContext): RenderedEmail => {
  const renderer = EMAIL_TEMPLATES[templateCode];
  if (!renderer) {
    return {
      subject: String(ctx.subject ?? 'ANWAR KPIFlow notification'),
      html: layout(ctx, String(ctx.subject ?? 'ANWAR KPIFlow notification'), p(esc(ctx.detail ?? '')),
      ),
      text: String(ctx.detail ?? 'ANWAR KPIFlow notification'),
    };
  }
  return renderer({
    appName: process.env.APP_NAME ?? 'ANWAR KPIFlow',
    appUrl: process.env.APP_URL ?? 'http://localhost:5173',
    ...ctx,
  });
};
