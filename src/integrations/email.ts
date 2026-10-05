import { promises as dns } from 'node:dns';
import { isIP } from 'node:net';
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

type SendResult = { sent: boolean; provider: string };

const smtpConfigured = () => Boolean(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS);

/** One pooled connection reused across sends, rather than a TLS handshake per email. */
let transport: Transporter | null = null;

/**
 * Render resolves mail hosts to IPv6 first but cannot route IPv6 out, so a connection by
 * hostname hangs until it times out (or fails with ENETUNREACH). Resolve to an IPv4
 * address ourselves and connect to that; TLS still verifies the certificate against the
 * real hostname via `servername`.
 */
async function resolveIPv4(host: string): Promise<string> {
  if (isIP(host)) return host;
  try {
    const [address] = await dns.resolve4(host);
    if (address) return address;
  } catch (err) {
    logger.warn(`[email] IPv4 lookup failed for ${host}; connecting by name`, err);
  }
  return host;
}

async function getTransport(): Promise<Transporter> {
  if (!transport) {
    const hostname = env.SMTP_HOST!;
    const port = env.SMTP_PORT ?? 587;
    transport = nodemailer.createTransport({
      host: await resolveIPv4(hostname),
      port,
      // 465 is implicit TLS; 587/25 start plain and upgrade with STARTTLS.
      secure: env.SMTP_SECURE ? env.SMTP_SECURE === 'true' : port === 465,
      auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
      tls: { servername: hostname },
      pool: true,
      /*
       * nodemailer waits two minutes for a connection by default, and the forgot-password
       * request waits on the send — so an unreachable mail server kept the customer
       * staring at "Sending…" for 2 minutes before failing. A healthy server answers in
       * well under a second.
       */
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });
  }
  return transport;
}

async function sendViaSmtp(message: EmailMessage): Promise<SendResult> {
  try {
    const smtp = await getTransport();
    await smtp.sendMail({
      from: env.EMAIL_FROM || `Viaro <${env.SMTP_USER}>`,
      to: message.to,
      replyTo: message.replyTo,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
    return { sent: true, provider: 'smtp' };
  } catch (err) {
    // Drop the pool so the next send re-resolves the host instead of reusing a dead address.
    transport?.close();
    transport = null;
    /*
     * ETIMEDOUT / ECONNREFUSED on every port means the host blocks outbound SMTP (Render's
     * free tier does). EAUTH means the mailbox credentials are wrong.
     */
    const code = (err as { code?: string }).code;
    logger.error(`Email delivery failed (smtp ${env.SMTP_HOST}:${env.SMTP_PORT ?? 587}, ${code ?? 'no code'})`, err);
    return { sent: false, provider: 'smtp' };
  }
}

export async function sendEmail(message: EmailMessage): Promise<SendResult> {
  if (smtpConfigured()) return sendViaSmtp(message);

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
