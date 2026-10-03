import nodemailer, { type Transporter } from 'nodemailer';
import { env, isProduction } from '../config/env';
import { logger } from '../utils/logger';

/**
 * Transactional email (password reset links, support-case alerts), sent over SMTP:
 * SMTP_HOST / SMTP_PORT / SMTP_SECURE / SMTP_USER / SMTP_PASS, from EMAIL_FROM.
 *
 * With SMTP not configured the message is logged instead of sent, so local runs work
 * without a mailbox — and the reset link is printed so you can still test the flow.
 */
export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  /** Replies go here rather than to the no-reply sender, e.g. the customer on a case alert. */
  replyTo?: string;
  /** Optional HTML body (see emailTemplates.ts); `text` stays as the plain-text part. */
  html?: string;
}

const isConfigured = () => Boolean(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS);

/** One pooled connection reused across sends, rather than a TLS handshake per email. */
let transport: Transporter | null = null;

function getTransport(): Transporter {
  if (!transport) {
    const port = env.SMTP_PORT ?? 587;
    transport = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port,
      // 465 is implicit TLS; 587/25 start plain and upgrade with STARTTLS.
      secure: env.SMTP_SECURE ? env.SMTP_SECURE === 'true' : port === 465,
      auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
      pool: true,
      /*
       * nodemailer waits two minutes for a connection by default, and the forgot-password
       * request waits on the send — so an unreachable mail server (e.g. a host that
       * blocks outbound SMTP ports) kept the customer staring at "Sending…" for 2 minutes
       * before failing. A healthy server answers in well under a second.
       */
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });
  }
  return transport;
}

export async function sendEmail(message: EmailMessage): Promise<{ sent: boolean; provider: string }> {
  if (!isConfigured()) {
    /*
     * `text` contains password-reset links — a one-click account takeover for anyone who
     * can read the logs. Printed locally (where reading it from stdout is how you test
     * the flow) and redacted in production, where missing SMTP settings are a
     * misconfiguration rather than a workflow.
     */
    logger.info('[email] SMTP not configured — message not sent', {
      to: message.to,
      subject: message.subject,
      ...(isProduction ? { text: '[redacted]' } : { text: message.text }),
    });
    return { sent: false, provider: 'none' };
  }

  try {
    await getTransport().sendMail({
      from: env.EMAIL_FROM || `Viaro <${env.SMTP_USER}>`,
      to: message.to,
      replyTo: message.replyTo,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
    return { sent: true, provider: 'smtp' };
  } catch (err) {
    logger.error('Email delivery failed', err);
    return { sent: false, provider: 'smtp' };
  }
}
