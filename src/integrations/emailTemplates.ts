/**
 * Branded transactional email bodies.
 *
 * Email HTML is not web HTML: Outlook renders with Word, Gmail strips <style> blocks in
 * some views, and nothing runs scripts or loads web fonts reliably. So layout is nested
 * tables, every style is inline, and the button is a padded table cell around a link —
 * the pattern that survives every major client. Each template also returns a plain-text
 * part for clients that show text only, and for spam filters that score its absence.
 *
 * Colours are the Viaro brand manual's: Executive Black, Midnight Route, Cloud Leather,
 * Azure Drive.
 */

const BRAND = {
  black: '#060606',
  card: '#111111',
  border: '#232323',
  blue: '#1153A4',
  azure: '#6096BA',
  text: '#E1EFE6',
  muted: '#9BA59F',
};

const FONT = "'Helvetica Neue', Helvetica, Arial, sans-serif";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Shared frame: wordmark, a card for the content, and the footer. */
function layout({ preheader, body }: { preheader: string; body: string }): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark light">
<title>Viaro</title>
</head>
<body style="margin:0;padding:0;background:${BRAND.black};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BRAND.black};">
  <tr>
    <td align="center" style="padding:40px 16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;">
        <tr>
          <td align="center" style="padding:0 0 28px;font-family:${FONT};font-size:22px;font-weight:700;letter-spacing:8px;color:${BRAND.text};">
            VIARO
          </td>
        </tr>
        <tr>
          <td style="background:${BRAND.card};border:1px solid ${BRAND.border};border-radius:16px;padding:36px 32px;font-family:${FONT};color:${BRAND.text};">
            ${body}
          </td>
        </tr>
        <tr>
          <td align="center" style="padding:24px 8px 0;font-family:${FONT};font-size:12px;line-height:18px;color:${BRAND.muted};">
            Viaro &middot; Executive black car service across North America<br>
            This is an automated message &mdash; replies to it are not monitored.
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

/** A link styled as a button that renders in Outlook as well as everywhere else. */
function button(href: string, label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:28px 0;">
  <tr>
    <td align="center" style="background:${BRAND.blue};border-radius:999px;">
      <a href="${escapeHtml(href)}" target="_blank" style="display:inline-block;padding:14px 32px;font-family:${FONT};font-size:14px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#ffffff;text-decoration:none;">${escapeHtml(label)}</a>
    </td>
  </tr>
</table>`;
}

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

export function passwordResetEmail({
  name,
  link,
  expiresInMinutes,
}: {
  name?: string | null;
  link: string;
  expiresInMinutes: number;
}): RenderedEmail {
  const greeting = name ? `Hi ${name.split(' ')[0]},` : 'Hi,';

  const text = [
    greeting,
    '',
    'We received a request to reset the password for your Viaro account.',
    `Open this link to choose a new one. It expires in ${expiresInMinutes} minutes.`,
    '',
    link,
    '',
    "If you didn't ask for this, you can ignore this email — your password won't change.",
    '',
    '— Viaro',
  ].join('\n');

  const html = layout({
    preheader: `Reset your Viaro password. The link expires in ${expiresInMinutes} minutes.`,
    body: `
<p style="margin:0 0 6px;font-size:12px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:${BRAND.azure};">Password reset</p>
<h1 style="margin:0 0 20px;font-size:24px;line-height:30px;font-weight:700;color:${BRAND.text};">Choose a new password</h1>
<p style="margin:0 0 12px;font-size:15px;line-height:24px;color:${BRAND.text};">${escapeHtml(greeting)}</p>
<p style="margin:0;font-size:15px;line-height:24px;color:${BRAND.text};">
  We received a request to reset the password for your Viaro account. Use the button below to choose a new one.
</p>
${button(link, 'Reset password')}
<p style="margin:0 0 20px;font-size:13px;line-height:20px;color:${BRAND.muted};">
  This link expires in ${expiresInMinutes} minutes and can be used once.
</p>
<p style="margin:0 0 6px;font-size:13px;line-height:20px;color:${BRAND.muted};">Button not working? Paste this into your browser:</p>
<p style="margin:0 0 24px;font-size:13px;line-height:20px;word-break:break-all;"><a href="${escapeHtml(link)}" style="color:${BRAND.azure};text-decoration:underline;">${escapeHtml(link)}</a></p>
<p style="margin:0;padding-top:20px;border-top:1px solid ${BRAND.border};font-size:13px;line-height:20px;color:${BRAND.muted};">
  Didn't ask for this? You can safely ignore this email &mdash; your password won't change.
</p>`,
  });

  return { subject: 'Reset your Viaro password', text, html };
}

/* --------------------------- booking & trip emails ------------------------- */

/** A label/value row in a details card. Rows with an empty value are dropped. */
export type DetailRow = [label: string, value: string | null | undefined];

export interface Contact {
  phone?: string;
  email?: string;
}

interface DetailsEmailInput {
  subject: string;
  preheader: string;
  eyebrow: string;
  heading: string;
  name?: string | null;
  /** Paragraphs above the details card. */
  intro: string[];
  rows?: DetailRow[];
  /** Emphasised last row, e.g. ['Total', '$160.00']. */
  total?: [string, string];
  cta?: { href: string; label: string };
  /** Small print under the card — cancellation policy, what happens next. */
  notes?: string[];
  contact?: Contact;
}

function contactLines(contact?: Contact): string[] {
  if (!contact?.phone && !contact?.email) return [];
  return [
    'Questions about your booking? Contact us:',
    ...(contact.phone ? [`Phone: ${contact.phone}`] : []),
    ...(contact.email ? [`Email: ${contact.email}`] : []),
  ];
}

/**
 * The shared shape of every booking/trip email: heading, a short intro, a details card,
 * an optional button and small print. Plain text is built from the same input, so the
 * two parts can never say different things.
 */
export function detailsEmail(input: DetailsEmailInput): RenderedEmail {
  const greeting = input.name ? `Hi ${input.name.split(' ')[0]},` : 'Hi,';
  const rows = (input.rows ?? []).filter((r): r is [string, string] => Boolean(r[1]));
  const contact = contactLines(input.contact);

  const text = [
    greeting,
    '',
    ...input.intro.flatMap((p) => [p, '']),
    ...rows.map(([label, value]) => `${label}: ${value}`),
    ...(input.total ? [`${input.total[0]}: ${input.total[1]}`] : []),
    ...(rows.length || input.total ? [''] : []),
    ...(input.cta ? [`${input.cta.label}: ${input.cta.href}`, ''] : []),
    ...(input.notes ?? []).flatMap((n) => [n, '']),
    ...(contact.length ? [...contact, ''] : []),
    '— Viaro',
  ].join('\n');

  const rowHtml = rows
    .map(
      ([label, value]) => `<tr>
  <td style="padding:8px 0;font-size:13px;line-height:20px;color:${BRAND.muted};vertical-align:top;width:40%;">${escapeHtml(label)}</td>
  <td style="padding:8px 0;font-size:14px;line-height:20px;color:${BRAND.text};vertical-align:top;">${escapeHtml(value)}</td>
</tr>`,
    )
    .join('');
  const totalHtml = input.total
    ? `<tr>
  <td style="padding:14px 0 0;border-top:1px solid ${BRAND.border};font-size:14px;font-weight:700;color:${BRAND.text};">${escapeHtml(input.total[0])}</td>
  <td style="padding:14px 0 0;border-top:1px solid ${BRAND.border};font-size:20px;font-weight:700;color:${BRAND.text};">${escapeHtml(input.total[1])}</td>
</tr>`
    : '';
  const card =
    rowHtml || totalHtml
      ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 0;padding:4px 16px 16px;background:${BRAND.black};border:1px solid ${BRAND.border};border-radius:12px;">${rowHtml}${totalHtml}</table>`
      : '';
  const notesHtml = (input.notes ?? [])
    .map((n) => `<p style="margin:16px 0 0;font-size:13px;line-height:20px;color:${BRAND.muted};">${escapeHtml(n)}</p>`)
    .join('');
  const contactHtml = contact.length
    ? `<p style="margin:20px 0 0;padding-top:20px;border-top:1px solid ${BRAND.border};font-size:13px;line-height:20px;color:${BRAND.muted};">${contact.map(escapeHtml).join('<br>')}</p>`
    : '';

  const html = layout({
    preheader: input.preheader,
    body: `
<p style="margin:0 0 6px;font-size:12px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:${BRAND.azure};">${escapeHtml(input.eyebrow)}</p>
<h1 style="margin:0 0 20px;font-size:24px;line-height:30px;font-weight:700;color:${BRAND.text};">${escapeHtml(input.heading)}</h1>
<p style="margin:0 0 12px;font-size:15px;line-height:24px;color:${BRAND.text};">${escapeHtml(greeting)}</p>
${input.intro.map((p) => `<p style="margin:0 0 12px;font-size:15px;line-height:24px;color:${BRAND.text};">${escapeHtml(p)}</p>`).join('')}
${card}
${input.cta ? button(input.cta.href, input.cta.label) : ''}
${notesHtml}
${contactHtml}`,
  });

  return { subject: input.subject, text, html };
}

export function welcomeEmail({ name, link }: { name?: string | null; link: string }): RenderedEmail {
  return detailsEmail({
    subject: 'Welcome to Viaro',
    preheader: 'Your Viaro account is ready.',
    eyebrow: 'Welcome',
    heading: 'Your account is ready',
    name,
    intro: [
      'Thanks for creating a Viaro account. You can now book a chauffeur, track your ride and manage your trips in one place.',
    ],
    cta: { href: link, label: 'Book a ride' },
    notes: ["Didn't create this account? Contact our support team and we'll close it."],
  });
}
