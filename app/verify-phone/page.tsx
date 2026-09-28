import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { PageShell, Panel } from "@/components/app/shell";
import { VerifyPhoneForm } from "@/components/app/verify-phone-form";
import { getCurrentUser } from "@/lib/auth/current-user";

export const metadata: Metadata = {
  title: "Verify your phone | Viaro",
  robots: { index: false, follow: false },
};

export default async function VerifyPhonePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/verify-phone");
  if (user.phoneVerified) redirect("/account");

  return (
    <PageShell
      title="Verify your phone"
      description="Chauffeurs use this number to reach you on the day."
      action={
        <Button asChild variant="outline">
          <Link href="/account">Back to account</Link>
        </Button>
      }
    >
      <Panel className="max-w-xl">
        <VerifyPhoneForm phone={user.phone} />
      </Panel>
    </PageShell>
  );
}
