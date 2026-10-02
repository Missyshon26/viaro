import type { Metadata } from "next";
import { AuthLayout } from "@/components/app/auth-layout";
import { ResetPasswordForm } from "@/components/app/auth-forms";

export const metadata: Metadata = { title: "Choose a new password | Viaro" };

/** The emailed link (/reset-password/confirm?token=…) is forwarded here by ./confirm. */
export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  return (
    <AuthLayout title="Choose a new password">
      <ResetPasswordForm token={token ?? ""} />
    </AuthLayout>
  );
}
