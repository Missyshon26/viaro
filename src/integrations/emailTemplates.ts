/**
 * Every email the system sends, in one place — the same set, wording and look as the
 * original All Black Limo system, so customers and operations see what they are used to.
 *
 * Look: a black header carrying the email's title, a white body in a quiet grey, the
 * closing "Best regards, All Black Limo", and a footer with the social links. Email HTML is
 * not web HTML — Outlook renders with Word and Gmail strips <style> — so it is nested tables
 * with inline styles. Each message also carries a plain-text part built from the very same
 * blocks, so the two can never say different things.
 *
 * Which event sends each one is listed in EMAIL_TEMPLATES at the foot of this file.
 */

import { appWebUrl, publicApiUrl } from '../config/env';
import { CONTACT_EMAIL } from '../config/constants';

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

/* --------------------------------- building blocks ------------------------------ */

const FONT = "'Helvetica Neue', Helvetica, Roboto, Arial, sans-serif";
const BRAND_NAME = 'All Black Limo';
const WEBSITE = 'https://allblacklimoseattle.com';

const SOCIAL_LINKS = [
  { name: 'Facebook', icon: 'facebook.png', url: 'https://www.facebook.com/ALLBLACKLIMO/' },
  { name: 'Instagram', icon: 'instagram.png', url: 'https://www.instagram.com/all_black_limo/?hl=en' },
  { name: 'YouTube', icon: 'youtube.png', url: 'https://www.youtube.com/@allblacklimo' },
  { name: 'X', icon: 'x.png', url: 'https://x.com/ablseattle?s=21&t=uXVlydXWGs4bhFqxvH6m6A' },
] as const;

const NO_REPLY = 'This is an automated message. Please do not reply to this email.';

type Block =
  | { t: 'p'; text: string }
  | { t: 'heading'; text: string }
  | { t: 'list'; items: Array<[label: string, value: string] | string> }
  | { t: 'button'; label: string; href: string }
  | { t: 'badge'; text: string };

const p = (text: string): Block => ({ t: 'p', text });
const heading = (text: string): Block => ({ t: 'heading', text });
const list = (items: Array<[string, string | null | undefined] | string>): Block => ({
  t: 'list',
  // A row with nothing to show is left out rather than printed as "undefined".
  items: items.filter((i): i is [string, string] | string => (typeof i === 'string' ? true : Boolean(i[1]))) as Array<
    [string, string] | string
  >,
});
const button = (label: string, href: string): Block => ({ t: 'button', label, href });
const badge = (text: string): Block => ({ t: 'badge', text });

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** `**bold**` is the only markup a paragraph may carry; everything else is escaped text. */
const inlineHtml = (text: string) => escapeHtml(text).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
const inlineText = (text: string) => text.replace(/\*\*(.+?)\*\*/g, '$1');

const BODY_STYLE = 'color:#666666;';

function blockHtml(block: Block): string {
  switch (block.t) {
    case 'p':
      return `<p style="${BODY_STYLE}margin:0 0 14px;">${inlineHtml(block.text)}</p>`;
    case 'heading':
      return `<p style="margin:18px 0 6px;color:#333333;font-weight:bold;">${inlineHtml(block.text)}</p>`;
    case 'list':
      return `<ul style="${BODY_STYLE}margin:0 0 14px;padding-left:20px;">${block.items
        .map((item) =>
          typeof item === 'string'
            ? `<li>${inlineHtml(item)}</li>`
            : `<li><strong>${escapeHtml(item[0])}:</strong> ${inlineHtml(item[1])}</li>`,
        )
        .join('')}</ul>`;
    case 'button':
      return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:22px 0;"><tr><td align="center" bgcolor="#000000" style="background:#000000;border-radius:3px;"><a href="${escapeHtml(block.href)}" target="_blank" style="display:inline-block;padding:13px 28px;font-family:${FONT};font-size:14px;font-weight:bold;color:#ffffff;text-decoration:none;">${escapeHtml(block.label)}</a></td></tr></table>`;
    case 'badge':
      return `<p style="margin:0 0 14px;"><span style="display:inline-block;background:#1a7f37;color:#ffffff;font-size:12px;font-weight:bold;letter-spacing:1px;padding:4px 12px;border-radius:3px;">${escapeHtml(block.text)}</span></p>`;
  }
}

function blockText(block: Block): string {
  switch (block.t) {
    case 'p':
      return inlineText(block.text);
    case 'heading':
      return inlineText(block.text).toUpperCase();
    case 'list':
      return block.items
        .map((item) => (typeof item === 'string' ? `- ${inlineText(item)}` : `- ${item[0]}: ${inlineText(item[1])}`))
        .join('\n');
    case 'button':
      return `${block.label}: ${block.href}`;
    case 'badge':
      return `[${block.text}]`;
  }
}

function footerHtml(allowReply: boolean): string {
  const icons = SOCIAL_LINKS.map(
    ({ name, icon, url }) =>
      `<td style="padding:0 6px;"><a href="${url}" target="_blank" rel="noopener noreferrer" style="text-decoration:none;"><img src="${publicApiUrl}/email_icons/${icon}" alt="${name}" title="${name}" width="32" height="32" style="display:block;width:32px;height:32px;border:0;"></a></td>`,
  ).join('');

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
<tr><td align="center" style="padding:24px 16px 8px;font-family:${FONT};font-size:13px;color:#6b6b6b;">Follow ${BRAND_NAME}</td></tr>
<tr><td align="center"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>${icons}</tr></table></td></tr>
<tr><td align="center" style="padding:14px 16px 0;font-family:${FONT};font-size:12px;line-height:18px;color:#8a8a8a;">
<a href="${WEBSITE}" target="_blank" rel="noopener noreferrer" style="color:#8a8a8a;text-decoration:none;">allblacklimoseattle.com</a><br>
&copy; ${new Date().getFullYear()} ${BRAND_NAME}. All rights reserved.${allowReply ? '' : `<br><br>${NO_REPLY}`}
</td></tr></table>`;
}

interface Compose {
  subject: string;
  /** The heading in the black band; also the first line of the plain-text part. */
  title: string;
  preheader?: string;
  blocks: Block[];
  /** What the sender line says; the customer emails all close the same way. */
  signoff?: string;
  /** No-show and rejection emails invite a reply, so they skip the do-not-reply note. */
  allowReply?: boolean;
}

function compose({ subject, title, preheader, blocks, signoff = BRAND_NAME, allowReply = false }: Compose): RenderedEmail {
  const body = blocks.map(blockHtml).join('\n');

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title></head>
<body style="margin:0;padding:0;background:#f7f7f7;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(preheader ?? title)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f7f7f7;">
<tr><td align="center" style="padding:40px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:#ffffff;border:1px solid #dedede;border-radius:3px;">
<tr><td bgcolor="#000000" style="background:#000000;padding:36px 48px;border-radius:3px 3px 0 0;"><h1 style="margin:0;font-family:${FONT};font-size:30px;font-weight:300;line-height:150%;color:#ffffff;">${escapeHtml(title)}</h1></td></tr>
<tr><td style="padding:48px 48px 24px;font-family:${FONT};font-size:14px;line-height:150%;color:#636363;">
${body}
<p style="${BODY_STYLE}margin:0 0 14px;">Best regards,<br>${escapeHtml(signoff)}</p>
</td></tr>
<tr><td style="background:#ffffff;border-top:1px solid #e5e5e5;border-radius:0 0 3px 3px;">${footerHtml(allowReply)}</td></tr>
</table></td></tr></table>
</body></html>`;

  const text = [
    title,
    '',
    ...blocks.flatMap((b) => [blockText(b), '']),
    'Best regards,',
    signoff,
    '',
    '—',
    `${BRAND_NAME} · ${WEBSITE}`,
    ...(allowReply ? [] : [NO_REPLY]),
  ].join('\n');

  return { subject, text, html };
}

const dear = (name?: string | null) => `Dear ${name?.trim() || 'Customer'},`;
const money = (n?: number | null) => (typeof n === 'number' ? `$${n.toFixed(2)}` : undefined);

/** What a customer can reply to or write to. */
const SUPPORT = CONTACT_EMAIL;

/* ----------------------------------- accounts ----------------------------------- */

/** A customer signed up (form or Google). */
export function accountCreatedEmail({ name }: { name?: string | null }): RenderedEmail {
  return compose({
    subject: 'Welcome to All Black Limo – Your Account Has Been Created',
    title: 'Account Created',
    blocks: [
      p(dear(name)),
      p('Your account has been successfully created. Welcome to All Black Limo! We are excited to have you on board.'),
      p(`Thank you for choosing All Black Limo. If you have any questions or need assistance, feel free to contact our support team at ${SUPPORT}.`),
    ],
  });
}

/** An operator added the customer: the same welcome, plus a link to choose their own password. */
export function accountInviteEmail({
  name,
  link,
  expiresInMinutes,
}: {
  name?: string | null;
  link: string;
  expiresInMinutes: number;
}): RenderedEmail {
  return compose({
    subject: 'Account Created',
    title: 'Account Created',
    blocks: [
      p(dear(name)),
      p('An account has been created for you with All Black Limo. Welcome! We are excited to have you on board.'),
      p('To sign in, choose a password for your account using the button below:'),
      button('Set Your Password', link),
      p(`For security, the link expires in ${Math.round(expiresInMinutes / 60)} hour${Math.round(expiresInMinutes / 60) === 1 ? '' : 's'}. If it has expired, use "Forgot password?" on the sign-in page to get a new one.`),
      p(`Thank you for choosing All Black Limo. If you have any questions or need assistance, feel free to contact our support team at ${SUPPORT}.`),
    ],
  });
}

/** "Continue as guest" made an account; offering a password is optional. */
export function guestWelcomeEmail({
  name,
  link,
  expiresInMinutes,
}: {
  name?: string | null;
  link: string;
  expiresInMinutes: number;
}): RenderedEmail {
  const who = name?.trim();
  return compose({
    subject: 'Welcome to All Black Limo - set your password',
    title: 'Welcome to All Black Limo',
    blocks: [
      p(!who || who.toLowerCase() === 'guest' ? 'Hello,' : dear(who)),
      p('Thank you for booking with All Black Limo. We have created an account for you with this email address, so you can view your trips and book faster next time.'),
      p('To sign in later, set a password for your account using the button below:'),
      button('Set Your Password', link),
      p('This step is optional. You can keep booking as a guest, and your trips will be saved to this account.'),
      p(`For security, the link expires after ${Math.round(expiresInMinutes / 60)} hour${Math.round(expiresInMinutes / 60) === 1 ? '' : 's'}. If it has expired, use "Forgot password?" on the sign-in page to get a new one.`),
      p('If you did not make a booking with us, please ignore this email.'),
      p(`Questions? Contact us at ${SUPPORT}.`),
    ],
  });
}

export function resetPasswordEmail({
  name,
  link,
  expiresInMinutes,
}: {
  name?: string | null;
  link: string;
  expiresInMinutes: number;
}): RenderedEmail {
  return compose({
    subject: 'Reset Password',
    title: 'Reset Password',
    blocks: [
      p(dear(name)),
      p('We received a request to reset the password for your account. To proceed, please click the link below to securely reset your password:'),
      button('Reset Password', link),
      p(`For security reasons, this link will expire after ${expiresInMinutes} minutes. If you did not request a password reset, please ignore this email. Your account will remain secure.`),
      p(`Thank you for choosing All Black Limo. If you have any questions or need assistance, feel free to contact our support team at ${SUPPORT}.`),
    ],
  });
}

/** An operator changed the phone number on the customer's account. */
export function contactNumberResetEmail({ name, phone }: { name?: string | null; phone: string }): RenderedEmail {
  return compose({
    subject: 'All Black Limo Contact Number reset',
    title: 'Contact Number Updated',
    blocks: [
      p(dear(name)),
      p('We hope this message finds you well. Thank you for choosing All Black Limo for your upcoming trip. We are delighted to confirm that the contact number on your account has been updated.'),
      list([['Updated Contact Number', phone]]),
      p('Should you have any specific requirements or if there are changes to your travel plans, please feel free to contact our customer support team.'),
      p('Your satisfaction and safety are our top priorities, and we assure you that our driver will provide you with a comfortable and secure journey.'),
      p('Thank you for choosing All Black Limo. We look forward to serving you and ensuring a seamless travel experience.'),
    ],
    signoff: 'All Black Limo Support Team',
  });
}

/* ------------------------------- a booking, in order ------------------------------ */

export interface TripFacts {
  ref: string;
  pickup: string;
  drop: string;
  when: string;
  vehicle: string;
}

/** The unpaid invoice, with the PDF attached: sent when a booking exists but is not yet paid. */
export function prePaymentInvoiceEmail({ name, ref }: { name?: string | null; ref: string }): RenderedEmail {
  return compose({
    subject: `Your All Black Limo Invoice - Trip #${ref}`,
    title: 'Your Invoice',
    preheader: `Invoice for reservation #${ref}`,
    blocks: [
      p(`${BRAND_NAME} — Trip #${ref}`),
      p(dear(name ?? 'Guest')),
      p(`Thank you for booking with All Black Limo. We've attached your invoice for reservation #${ref} to this email.`),
      p('To confirm this reservation, please complete your payment. This invoice reflects the amount due — you have not been charged yet.'),
      p('Full trip details are in the attached invoice.'),
      p("If you've already completed payment, you'll receive a separate payment receipt confirming your reservation shortly."),
    ],
  });
}

/** Paid by card: the receipt, attached. */
export function paymentReceiptEmail({
  name,
  ref,
  amount,
}: {
  name?: string | null;
  ref: string;
  amount?: number;
}): RenderedEmail {
  return compose({
    subject: `Payment Received - All Black Limo - Trip #${ref}`,
    title: 'Payment Received',
    preheader: `Reservation #${ref} is paid and confirmed.`,
    blocks: [
      badge('PAID'),
      p(`${BRAND_NAME} — Trip #${ref}`),
      p(dear(name ?? 'Guest')),
      p(`Thank you for your payment. Your reservation #${ref} is now fully paid and confirmed.`),
      ...(amount !== undefined ? [p(`**Amount paid: ${money(amount)}**`)] : []),
      p("We've attached your payment receipt to this email for your records."),
      p('Full trip details are in the attached receipt.'),
      p('Safe travels!'),
    ],
  });
}

/** An operator asks the customer to pay: the pay-online link. */
export function paymentRequestedEmail({
  name,
  ref,
  amount,
  link,
  expiresLabel,
  trip,
}: {
  name?: string | null;
  ref: string;
  amount: number;
  link: string;
  expiresLabel: string;
  trip: Omit<TripFacts, 'ref'>;
}): RenderedEmail {
  return compose({
    subject: 'Payment requested',
    title: 'Payment Requested',
    preheader: `Pay ${money(amount)} to complete your booking.`,
    blocks: [
      p(dear(name)),
      p('This trip has been created for you by All Black Limo. We will assign a chauffeur and send you another email.'),
      p(`You have a pending payment of **${money(amount)}** for trip number **${ref}**. To complete the payment, please click the link below:`),
      list([
        ['Pickup', trip.pickup],
        ['Drop-off', trip.drop],
        ['Pickup time', trip.when],
        ['Vehicle', trip.vehicle],
      ]),
      button('Pay Now', link),
      p(`This link works until ${expiresLabel}. If it has expired, contact us and we will send a new one. You will not be charged until you complete the payment on the secure Stripe page.`),
      p(`If you have any questions or concerns, please don't hesitate to contact us at ${SUPPORT}.`),
      p('Thank you for your business!'),
    ],
  });
}

/** An invoice sent on request, attached. */
export function invoiceEmail(): RenderedEmail {
  return compose({
    subject: 'Invoice',
    title: 'Invoice',
    blocks: [
      p('Dear Customer,'),
      p('Thank you for reaching out to us. As requested, we have attached the invoice for your reference.'),
      p(`Please take a moment to review the details at your convenience, and if you have any questions or require further assistance, feel free to reach us at ${SUPPORT}`),
    ],
  });
}

/** The reminder before a trip. */
export function reminderEmail({
  name,
  when,
  pickup,
  drop,
  chauffeur,
}: {
  name?: string | null;
  when: string;
  pickup: string;
  drop: string;
  chauffeur?: string;
}): RenderedEmail {
  return compose({
    subject: 'Upcoming Trip – Please Confirm Your Details',
    title: 'Upcoming Trip – Please Confirm Your Details',
    blocks: [
      p(dear(name)),
      p(`This is a friendly reminder from All Black Limo about your upcoming trip scheduled for **${when}**. Please take a moment to confirm the following details:`),
      list([
        ['Pickup Location', pickup],
        ['Drop-off Location', drop],
        ['Pickup Time', when],
      ]),
      p(
        chauffeur
          ? `Your chauffeur is ${chauffeur}.`
          : 'Your chauffeur will be assigned shortly, and you will receive a follow-up email with their name and contact information once confirmed.',
      ),
      p(`If you need to make any changes, please email us at ${SUPPORT}. Be sure to include your Name, Booking Number, and Phone Number in the message.`),
      p('We look forward to providing you with a smooth and comfortable experience.'),
    ],
  });
}

/* --------------------------------- on the day -------------------------------------- */

const CHAUFFEUR = (driverName?: string | null, driverPhone?: string | null) =>
  list([
    ['Chauffeur Name', driverName],
    ['Chauffeur Contact', driverPhone],
  ]);

const ASSIST = p("If you have any questions or require further assistance, please don't hesitate to reach out to us.");

export function chauffeurAssignedEmail({
  name,
  driverName,
  driverPhone,
}: {
  name?: string | null;
  driverName?: string | null;
  driverPhone?: string | null;
}): RenderedEmail {
  return compose({
    subject: 'Chauffeur Assignment Confirmation for Your Trip',
    title: 'Chauffeur Assigned',
    blocks: [
      p(dear(name)),
      p('We are delighted to inform you that a chauffeur has been assigned for your upcoming trip. Below are the details:'),
      list([
        ['Driver Name', driverName],
        ['Driver Contact', driverPhone],
      ]),
      ASSIST,
      p('Wishing you safe travels!'),
    ],
  });
}

export function tripConfirmedEmail({
  name,
  ref,
  driverName,
  driverPhone,
  pickup,
  when,
  vehicle,
}: {
  name?: string | null;
  ref: string;
  driverName?: string | null;
  driverPhone?: string | null;
  pickup: string;
  when: string;
  vehicle: string;
}): RenderedEmail {
  return compose({
    subject: 'Trip Confirmed',
    title: 'Trip Confirmed!',
    blocks: [
      p(dear(name)),
      p("We're thrilled to confirm your trip with All Black Limo! Below are the details of your upcoming journey:"),
      heading('Trip Details:'),
      list([
        ['Booking ID', ref],
        ['Pickup Location', pickup],
        ['Date & Time', when],
        ['Driver’s Name', driverName],
        ['Driver’s contact no', driverPhone],
      ]),
      heading('Vehicle Details:'),
      list([vehicle]),
      p('Please ensure you’re ready at the pickup location at the scheduled time.'),
      ASSIST,
      p('Wishing you safe travels!'),
    ],
  });
}

export function chauffeurEnrouteEmail(input: { name?: string | null; driverName?: string | null; driverPhone?: string | null }): RenderedEmail {
  return compose({
    subject: 'Enroute Trip',
    title: 'Enroute',
    blocks: [
      p(dear(input.name)),
      p('We’re happy to inform you that your journey is now underway! Our chauffeur is on the road, and we are ensuring a smooth and comfortable ride for you.'),
      p('If you have any questions or need assistance during your trip, feel free to reach out to your chauffeur:'),
      CHAUFFEUR(input.driverName, input.driverPhone),
      ASSIST,
      p('Wishing you safe travels!'),
    ],
  });
}

export function chauffeurArrivedEmail(input: { name?: string | null; driverName?: string | null; driverPhone?: string | null }): RenderedEmail {
  return compose({
    subject: 'Chauffeur Arrived!',
    title: 'Chauffeur Arrived!',
    blocks: [
      p(dear(input.name)),
      p('We’re excited to inform you that your ride has arrived at the pickup location. If you encounter any difficulties, please contact our chauffeur at:'),
      CHAUFFEUR(input.driverName, input.driverPhone),
      ASSIST,
      p('Wishing you safe travels!'),
    ],
  });
}

export function onboardEmail(input: { name?: string | null; driverName?: string | null; driverPhone?: string | null }): RenderedEmail {
  return compose({
    subject: 'Onboard Trip',
    title: 'Onboard',
    blocks: [
      p(dear(input.name)),
      p('We’re excited to let you know that you’re now onboard and your trip is underway. Our chauffeur is here to ensure a comfortable and enjoyable ride to your destination.'),
      p('If you have any requests or need assistance while onboard, feel free to contact your chauffeur directly:'),
      CHAUFFEUR(input.driverName, input.driverPhone),
      ASSIST,
      p('Wishing you safe travels!'),
    ],
  });
}

/** The short "your trip is complete" note (when an operator closes a trip). */
export function tripCompletedEmail({ name }: { name?: string | null }): RenderedEmail {
  return compose({
    subject: 'Trip Completed',
    title: 'Trip Completed',
    blocks: [
      p(dear(name)),
      p('We’re pleased to inform you that your trip has been successfully completed. We hope you had a comfortable and enjoyable journey!'),
      p('If you have any feedback or if there’s anything else we can assist you with, please feel free to share. Your experience matters to us, and we’d love to hear from you.'),
      p('Thank you for choosing All Black Limo. We look forward to serving you again in the future!'),
    ],
  });
}

const ABOUT: Block[] = [
  heading('About All Black Limo'),
  p('Seattle’s premier luxury transportation provider specializing exclusively in airport transfers. Established in 2023, All Black Limo has built a solid reputation as the leading choice for limousine and luxury transportation services in Seattle.'),
  p('Our services are tailored specifically for airport transfers, ensuring a seamless and luxurious experience for our clients. With a focus on corporate travel and special events, All Black Limo offers sleek and stylish vehicles paired with exceptional service and attention to detail. Choose All Black Limo for a truly extraordinary and memorable transportation experience.'),
  heading('TRAVEL:'),
  p('Luxury Transportation Services | All Black Limo: Explore Destinations in Style'),
  p('Discover seamless travel experiences with All Black Limo luxury transportation services. Whether for corporate events, special celebrations, or reliable transportation needs, trust All Black Limo to take you in comfort and style. From bustling city centers to serene countryside retreats, All Black Limo is your trusted partner for exploring diverse destinations effortlessly. Begin your journey with All Black Limo and experience travel redefined.'),
];

/** Thanks for riding: the trip's details, with the invoice or receipt attached. */
export function thankYouEmail({
  name,
  ref,
  when,
  pickup,
  drop,
  price,
  vehicle,
  phone,
  email,
}: {
  name?: string | null;
  ref: string;
  when: string;
  pickup: string;
  drop: string;
  price?: number;
  vehicle: string;
  phone?: string;
  email?: string;
}): RenderedEmail {
  return compose({
    subject: 'All Black Limo Trip Completed',
    title: 'Trip Completed',
    blocks: [
      p(dear(name)),
      p('Thank you for choosing All Black Limo for your recent ride! We hope you had a pleasant experience.'),
      p('Your feedback is invaluable to us in our efforts to continually improve our service. Did we meet your expectations? Please share any suggestions on how we can enhance your experience next time.'),
      p('Your ride has been charged to the payment method selected during booking, so no further action is required from you. Attached to this email, you will find a copy of your invoice for your reference.'),
      list([
        ['Booking Number', ref],
        ['Date and time', when],
        ['From', pickup],
        ['To', drop],
        ['Price', money(price)],
        ['Vehicle', vehicle],
        ['Mobile', phone],
        ['Email', email],
      ]),
      p('Safe travels!'),
      ...ABOUT,
    ],
  });
}

/* ------------------------- cancelled, rejected, no-show -------------------------- */

export function bookingCancellationEmail({ name }: { name?: string | null }): RenderedEmail {
  return compose({
    subject: 'Booking Cancellation Confirmation',
    title: 'Trip Canceled',
    blocks: [
      p(dear(name)),
      p('Warm greetings from All Black Limo!'),
      p('We are writing to confirm the receipt and processing of your request to cancel your booking. Your cancellation has been successfully processed, and you can view the updated status in your account.'),
      p('Should you need further assistance or have any questions, our dedicated customer support team is ready to assist you promptly.'),
      p(`For inquiries or concerns, please reach out to us at ${SUPPORT}.`),
      p('Thank you for choosing All Black Limo!'),
    ],
  });
}

export function bookingRejectionEmail({
  name,
  reason,
  ref,
}: {
  name?: string | null;
  reason: string;
  ref: string;
}): RenderedEmail {
  return compose({
    subject: 'Booking Rejection Notice',
    title: 'Trip Rejected',
    allowReply: true,
    blocks: [
      p(dear(name)),
      p(`Thank you for choosing ${BRAND_NAME}. We’ve reviewed your recent booking request (ID: ${ref}).`),
      p(`**Reason:** ${reason}`),
      p('We understand this may be disappointing, and we truly appreciate your interest. If you’d like to update your request or explore alternative options, we’re here to help—just reply to this email or contact our support team anytime.'),
      p('Thank you for choosing All Black Limo!'),
    ],
  });
}

export function noShowEmail({ name, ref }: { name?: string | null; ref: string }): RenderedEmail {
  return compose({
    subject: 'Your Reservation Has Been Marked as a No-Show',
    title: 'Reservation Marked as No-Show',
    allowReply: true,
    signoff: 'All Black Limo Customer Service Team',
    blocks: [
      p(`Hi ${name?.trim() || 'Customer'},`),
      p(`We're contacting you regarding your scheduled reservation with All Black Limo (Trip #${ref}).`),
      p('Our chauffeur arrived at the confirmed pickup location at the scheduled time and remained through the applicable complimentary waiting period. We also attempted to contact you but were unable to reach you.'),
      p('Because we were unable to make contact or complete the pickup, the reservation has been marked as a **No-Show**. The trip remains subject to the applicable charges under our cancellation and no-show policy.'),
      p('If you believe this was marked incorrectly, or there were circumstances we should be aware of, please reply to this email. Our customer service team will be happy to review the reservation.'),
      p('Thank you,'),
    ],
  });
}

/* ----------------------------- document verification ------------------------------ */

export function documentApprovedEmail({ name }: { name?: string | null }): RenderedEmail {
  return compose({
    subject: 'Your Document Has Been Approved',
    title: 'Document Approved',
    blocks: [
      p(dear(name)),
      p('We are pleased to confirm that your document has been successfully verified. Your information has been thoroughly reviewed and confirmed.'),
      p('Should you have any additional questions or concerns, please do not hesitate to reach out to us.'),
      p('Thank you for choosing All Black Limo’s services!'),
    ],
  });
}

export function documentRejectedEmail({ name }: { name?: string | null }): RenderedEmail {
  return compose({
    subject: 'Document Verification Failed',
    title: 'Document Failed',
    blocks: [
      p(dear(name)),
      p('We are sorry to inform you that your document verification failed. Your information has been reviewed and rejected.'),
      p(`If you have any further questions or concerns, please feel free to contact us at ${SUPPORT}.`),
      p('Thank you for choosing our services!'),
    ],
  });
}

/* ----------------------------------- to operations -------------------------------- */

export function adminNewCustomerEmail({
  name,
  email,
  phone,
  guest = false,
}: {
  name: string;
  email: string;
  phone?: string;
  guest?: boolean;
}): RenderedEmail {
  return compose({
    subject: guest ? 'New Customer (Guest Checkout)' : 'New Customer Signed Up',
    title: 'New User Registered',
    signoff: 'All Black Limo Admin Team',
    blocks: [
      p(guest ? 'A new user has booked as a guest on All Black Limo.' : 'A new user has registered on All Black Limo.'),
      list([
        ['Name', name],
        ['Email', email],
        ['Phone', phone || 'N/A'],
      ]),
      p(`If you have any questions or need further details, please contact support at ${SUPPORT}.`),
    ],
  });
}

export function adminNewBookingEmail({
  customer,
  ref,
  bookedOn,
  tripType,
  vehicle,
  when,
  pickup,
  drop,
  viewUrl,
}: {
  customer: { name?: string; phone?: string; email?: string };
  ref: string;
  bookedOn: string;
  tripType: string;
  vehicle: string;
  when: string;
  pickup: string;
  drop: string;
  viewUrl?: string;
}): RenderedEmail {
  return compose({
    subject: 'New Booking',
    title: 'New Booking',
    signoff: 'All Black Limo Booking System',
    blocks: [
      p('Dear Admin,'),
      p('A new trip has been successfully booked. Below are the trip details:'),
      heading('Passenger Details'),
      list([
        ['Name', customer.name],
        ['Phone', customer.phone],
        ['Email', customer.email],
      ]),
      heading('Trip Information'),
      list([
        ['Trip Number', ref],
        ['Booking Date', bookedOn],
        ['Trip Type', tripType],
        ['Vehicle', vehicle],
        ['Pickup Time', when],
        ['Pickup', pickup],
        ['Drop-off', drop],
      ]),
      ...(viewUrl ? [button('View trip', viewUrl)] : []),
      p('Please review and take necessary action.'),
      p('Thank you.'),
    ],
  });
}

export function adminTripCancelledEmail({
  ref,
  customer,
  pickup,
  drop,
  when,
  total,
  refund,
  cancelledBy,
}: {
  ref: string;
  customer: { name?: string; email?: string; phone?: string };
  pickup: string;
  drop: string;
  when: string;
  total?: number;
  refund?: number;
  cancelledBy?: string;
}): RenderedEmail {
  return compose({
    subject: `Trip Cancelled - #${ref}`,
    title: 'Trip Cancelled',
    signoff: 'All Black Limo System',
    blocks: [
      p(`Trip #${ref} was just cancelled${cancelledBy ? ` (${cancelledBy})` : ''}. Details below.`),
      list([
        ['Customer', customer.name || '-'],
        ['Email', customer.email || '-'],
        ['Phone', customer.phone || '-'],
        ['Route', `${pickup || '-'} → ${drop || '-'}`],
        ['Scheduled', when || '-'],
        ['Trip Total', money(total) ?? '-'],
        ['Refund Issued', refund ? money(refund) : 'None'],
      ]),
    ],
  });
}

/* ------------------------------------- the list ----------------------------------- */

/**
 * Every template, and the event that sends it.
 */
export const EMAIL_TEMPLATES = {
  accountCreatedEmail: { to: 'customer', sent: 'on sign-up (form or Google)' },
  accountInviteEmail: { to: 'customer', sent: 'when an operator adds a client' },
  guestWelcomeEmail: { to: 'customer', sent: 'on "Continue as guest"' },
  resetPasswordEmail: { to: 'customer', sent: 'on "Forgot password"' },
  contactNumberResetEmail: { to: 'customer', sent: 'when the phone number on an account is changed' },
  prePaymentInvoiceEmail: { to: 'customer', sent: 'when a booking is made and not yet paid' },
  paymentReceiptEmail: { to: 'customer', sent: 'when a booking is paid by card' },
  paymentRequestedEmail: { to: 'customer', sent: 'when an operator sends a payment link' },
  invoiceEmail: { to: 'customer', sent: 'when an operator presses "Email invoice"' },
  reminderEmail: { to: 'customer', sent: 'before the free-cancellation window closes' },
  chauffeurAssignedEmail: { to: 'customer', sent: 'when a chauffeur accepts the ride' },
  tripConfirmedEmail: { to: 'customer', sent: 'when an operator confirms a trip' },
  chauffeurEnrouteEmail: { to: 'customer', sent: 'when the chauffeur (or operations) marks "on the way"' },
  chauffeurArrivedEmail: { to: 'customer', sent: 'when the chauffeur (or operations) marks "arrived"' },
  onboardEmail: { to: 'customer', sent: 'when the chauffeur starts the ride' },
  tripCompletedEmail: { to: 'customer', sent: 'when operations close a trip by hand (the chauffeur finishing it sends the thank-you instead)' },
  thankYouEmail: { to: 'customer', sent: 'when a trip is completed' },
  bookingCancellationEmail: { to: 'customer', sent: 'when a booking or trip is cancelled' },
  bookingRejectionEmail: { to: 'customer', sent: 'when operations reject a booking request' },
  noShowEmail: { to: 'customer', sent: 'when an operator marks a trip as a no-show (copied to operations)' },
  documentApprovedEmail: { to: 'customer', sent: 'when an operator approves a signed agreement' },
  documentRejectedEmail: { to: 'customer', sent: 'when an operator rejects a signed agreement' },
  adminNewCustomerEmail: { to: 'operations', sent: 'when a customer signs up or books as a guest' },
  adminNewBookingEmail: { to: 'operations', sent: 'when a booking is made' },
  adminTripCancelledEmail: { to: 'operations', sent: 'when a booking or trip is cancelled' },
} as const;
