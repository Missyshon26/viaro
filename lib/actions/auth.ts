"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { ApiError, api, apiFetch } from "@/lib/api/client";
import { writeSession, clearSession, readTokens } from "@/lib/auth/session";
import type { AuthResult, UserRole } from "@/lib/api/types";

/**
 * Auth mutations as Server Actions.
 *
 * Forms post straight to these — no client-side fetch, no token ever in browser JS.
 * Each returns a `FormState` so the page can render field errors inline; success
 * paths redirect, which is why the return type allows never.
 */
export interface FormState {
  error?: string;
  fieldErrors?: Record<string, string>;
  /**
   * What was submitted, echoed back on failure. React resets an uncontrolled form once
   * its action settles, so without this a wrong password also wiped the email field.
   */
  values?: Record<string, string>;
}

/**
 * This site is the passenger product. A chauffeur, admin or fleet operator can hold a
 * valid session here, but has nothing to use — they are handed to /portal, which links
 * them to their own application.
 */
const homeFor = (role: UserRole) => (role === "customer" ? "/trips" : "/portal");

function toFormState(err: unknown): FormState {
  if (err instanceof ApiError) {
    return { error: err.message, fieldErrors: err.fieldErrors };
  }
  return { error: "Something went wrong. Please try again." };
}

export async function loginAction(
  _prev: FormState | undefined,
  formData: FormData,
): Promise<FormState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const requested = String(formData.get("next") ?? "");
  // Same-site paths only: "//host" and "/\host" are protocol-relative and would send a
  // freshly signed-in user to another site.
  const next = /^\/(?![/\\])/.test(requested) ? requested : "";

  let result: AuthResult;
  try {
    result = await apiFetch<AuthResult>("/auth/login", {
      method: "POST",
      body: { email, password },
      anonymous: true,
    });
  } catch (err) {
    return { ...toFormState(err), values: { email } };
  }

  await writeSession({
    accessToken: result.accessToken,
    refreshToken: result.refreshToken,
    role: result.role,
  });
  revalidatePath("/", "layout");
  redirect(next || homeFor(result.role));
}

export async function registerAction(
  _prev: FormState | undefined,
  formData: FormData,
): Promise<FormState> {
  // Passenger signup only. Chauffeurs are onboarded by a company or the platform,
  // and admin/company accounts are created out of band.
  const role: UserRole = "customer";

  const body: Record<string, unknown> = {
    role,
    name: String(formData.get("name") ?? "").trim(),
    email: String(formData.get("email") ?? "").trim(),
    phone: String(formData.get("phone") ?? "").trim(),
    password: String(formData.get("password") ?? ""),
  };
  let result: AuthResult;
  try {
    result = await apiFetch<AuthResult>("/auth/register", {
      method: "POST",
      body,
      anonymous: true,
    });
  } catch (err) {
    return {
      ...toFormState(err),
      values: { name: String(body.name), email: String(body.email), phone: String(body.phone) },
    };
  }

  await writeSession({
    accessToken: result.accessToken,
    refreshToken: result.refreshToken,
    role: result.role,
  });
  revalidatePath("/", "layout");
  redirect(homeFor(result.role));
}

export async function logoutAction() {
  const { refreshToken } = await readTokens();
  if (refreshToken) {
    // Blacklists the refresh token server-side; a failure here must not trap the
    // user in a session they asked to end, so the local cookies go regardless.
    await api.post("/auth/logout", { refreshToken }).catch(() => undefined);
  }
  await clearSession();
  revalidatePath("/", "layout");
  redirect("/login");
}

export async function forgotPasswordAction(
  _prev: FormState | undefined,
  formData: FormData,
): Promise<FormState & { sent?: boolean }> {
  try {
    await apiFetch("/auth/password/forgot", {
      method: "POST",
      body: { email: String(formData.get("email") ?? "").trim() },
      anonymous: true,
    });
    return { sent: true };
  } catch (err) {
    return toFormState(err);
  }
}

export async function resetPasswordAction(
  _prev: FormState | undefined,
  formData: FormData,
): Promise<FormState> {
  const token = String(formData.get("token") ?? "");
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirmPassword") ?? "");

  if (password !== confirm) {
    return { fieldErrors: { confirmPassword: "Passwords do not match" } };
  }

  try {
    await apiFetch("/auth/password/reset", {
      method: "POST",
      body: { token, password },
      anonymous: true,
    });
  } catch (err) {
    return toFormState(err);
  }
  redirect("/login?reset=1");
}

export async function sendPhoneCodeAction(): Promise<FormState & { sent?: boolean }> {
  try {
    await api.post("/auth/phone/send-code");
    return { sent: true };
  } catch (err) {
    return toFormState(err);
  }
}

export async function verifyPhoneAction(
  _prev: FormState | undefined,
  formData: FormData,
): Promise<FormState> {
  try {
    await api.post("/auth/phone/verify", { code: String(formData.get("code") ?? "").trim() });
  } catch (err) {
    return toFormState(err);
  }
  revalidatePath("/account");
  redirect("/account?verified=1");
}

