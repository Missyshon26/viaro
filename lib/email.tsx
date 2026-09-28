"use server";

import nodemailer from "nodemailer";
import { render } from "@react-email/render";
import { formSchema } from "./schema";
import { EmailTemplate } from "@/components/email-template";
import { apiFetch } from "@/lib/api/client";
import { SUPPORT_EMAIL } from "@/lib/constants";

/*
 * "Request a Quote" and /contact enquiries, delivered over SMTP.
 *
 * .env holds only the SMTP account (SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER,
 * SMTP_PASS) — a credential. WHERE enquiries go is a business setting: the support inbox
 * in the admin console (Drivers → Settings), read from the API's public settings. If the
 * API cannot be reached, they go to the published reservations address.
 *
 * Sent from the SMTP account itself, under the name below: providers reject a From
 * address the account does not own.
 */
const SENDER_NAME = "Viaro Website";

/** The admin-set inbox, or the published address if the API cannot be reached. */
async function enquiryInbox(): Promise<string> {
  try {
    const settings = await apiFetch<{ supportInboxEmail?: string }>("/settings/public", {
      anonymous: true,
      revalidate: 60,
    });
    return settings.supportInboxEmail?.trim() || SUPPORT_EMAIL;
  } catch {
    return SUPPORT_EMAIL;
  }
}

/** Shown instead of transport internals, which mean nothing to a visitor. */
const SEND_FAILED =
  "We couldn't send your request just now. Please call us on (206) 672-8281 or email reservations@viaro.io — we're available 24/7.";

export type FormState = {
  success: boolean;
  message?: string;
  /**
   * What was submitted, handed back on failure. React 19 resets a form after its action
   * runs, so without this a visitor who mistyped their email lost the whole message.
   */
  values?: { fullName: string; phone: string; email: string; message: string };
  errors?: {
    fullName?: string[];
    phone?: string[];
    email?: string[];
    message?: string[];
  };
};

function smtpConfig() {
  const host = process.env.SMTP_HOST?.trim();
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) return null;

  const port = Number(process.env.SMTP_PORT) || 587;
  return {
    transport: {
      host,
      port,
      // 465 is implicit TLS; 587/25 start plain and upgrade with STARTTLS.
      secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === "true" : port === 465,
      auth: { user, pass },
    },
    from: `${SENDER_NAME} <${user}>`,
  };
}

export async function send(
  _prevState: FormState,
  formData: FormData
): Promise<FormState> {
  const rawData = {
    fullName: formData.get("fullName")?.toString() ?? "",
    phone:    formData.get("phone")?.toString()    ?? "",
    email:    formData.get("email")?.toString()    ?? "",
    message:  formData.get("message")?.toString()  ?? "",
  };

  const validated = formSchema.safeParse(rawData);

  if (!validated.success) {
    return {
      success: false,
      errors: validated.error.flatten().fieldErrors,
      values: rawData,
    };
  }

  const { fullName, email, phone, message } = validated.data;

  /*
   * Checked per request, never at module scope. The old version built its mail client
   * when the module loaded and threw when the key was missing — the throw escaped the
   * action and the browser showed only "Minified React error #441". Missing settings now
   * become a readable message on the form.
   */
  const config = smtpConfig();
  if (!config) {
    console.error(
      "[quote] SMTP is not configured (SMTP_HOST / SMTP_USER / SMTP_PASS) — enquiry from %s was not sent",
      email,
    );
    return { success: false, message: SEND_FAILED, values: rawData };
  }

  try {
    const props = { fullName, email, phone, message };
    const [html, text] = await Promise.all([
      render(<EmailTemplate {...props} />),
      render(<EmailTemplate {...props} />, { plainText: true }),
    ]);

    await nodemailer.createTransport(config.transport).sendMail({
      from: config.from,
      to: await enquiryInbox(),
      replyTo: { name: fullName, address: email },
      subject: `New quote request from ${fullName}`,
      html,
      text,
    });

    return { success: true };
  } catch (err) {
    console.error("[quote] SMTP sending failed:", err);
    return { success: false, message: SEND_FAILED, values: rawData };
  }
}
