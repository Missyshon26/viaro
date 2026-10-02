import { redirect } from "next/navigation";

/**
 * The backend emails reset links as /reset-password/confirm?token=… (viaro-backend
 * auth.account.service.ts, built from APP_WEB_URL), but the form lives at /reset-password.
 * Nothing answered this path, so every emailed link opened a 404. Forward it, token intact.
 */
export default async function ResetPasswordConfirm({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  redirect(token ? `/reset-password?token=${encodeURIComponent(token)}` : "/reset-password");
}
