import nodemailer from 'nodemailer';
import { env, isProduction } from '../config/env';
import { logger } from '../utils/logger';

/**
 * Transactional email (password reset links, support-case alerts).
 *
 * EMAIL_PROVIDER selects the adapter:
 *   - `resend` — its REST API, authenticated with EMAIL_API_KEY
 *   - `smtp`   — any SMTP server (SMTP_HOST / SMTP_PORT / SMTP_SECURE / SMTP_USER / SMTP_PASS)
 * With nothing configured the message is logged instead of sent, so local runs work
 * without an account — and the reset token is printed so you can still test the flow.
 */
export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  /** Replies go here rather than to the no-reply sender, e.g. the customer on a case alert. */
  replyTo?: string;
}

function isConfigured(provider: string): boolean {
  if (provider === 'resend') return Boolean(env.EMAIL_API_KEY);
  if (provider === 'smtp') return Boolean(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS);
  return false;
}

export async function sendEmail(message: EmailMessage): Promise<{ sent: boolean; provider: string }> {
  const provider = (env.EMAIL_PROVIDER || '').toLowerCase();

  if (!provider || !isConfigured(provider)) {
    /*
     * `text` contains password-reset links — a one-click account takeover for anyone who
     * can read the logs. Printed locally (where reading it from stdout is how you test
     * the flow) and redacted in production, where no provider being configured is a
     * misconfiguration rather than a workflow.
     */
    logger.info('[email] no provider configured — message not sent', {
      to: message.to,
      subject: message.subject,
      ...(isProduction ? { text: '[redacted]' } : { text: message.text }),
    });
    return { sent: false, provider: provider || 'none' };
  }

  try {
    if (provider === 'smtp') {
      const port = env.SMTP_PORT ?? 587;
      await nodemailer
        .createTransport({
          host: env.SMTP_HOST,
          port,
          // 465 is implicit TLS; 587/25 start plain and upgrade with STARTTLS.
          secure: env.SMTP_SECURE ? env.SMTP_SECURE === 'true' : port === 465,
          auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
        })
        .sendMail({
          from: env.EMAIL_FROM ?? `Viaro <${env.SMTP_USER}>`,
          to: message.to,
          replyTo: message.replyTo,
          subject: message.subject,
          text: message.text,
        });
      return { sent: true, provider };
    }

    if (provider !== 'resend') throw new Error(`Email provider '${provider}' not implemented`);

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.EMAIL_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: env.EMAIL_FROM ?? 'Viaro <noreply@viaro.com>',
        to: [message.to],
        subject: message.subject,
        text: message.text,
        ...(message.replyTo ? { reply_to: message.replyTo } : {}),
      }),
    });

    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return { sent: true, provider };
  } catch (err) {
    logger.error('Email delivery failed', err);
    return { sent: false, provider };
  }
}
