import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { PageShell, Panel, SectionTitle, money, formatDate } from "@/components/app/shell";
import { StatusBadge } from "@/components/app/status-badge";
import {
  ProfileForm,
  DeleteAccountButton,
  ChangePasswordButton,
} from "@/components/app/account-forms";
import { getCurrentUser } from "@/lib/auth/current-user";
import { apiOptional } from "@/lib/api/client";
import type { Subscription } from "@/lib/api/types";
import { LiveRefresh } from "@/components/app/live-refresh";

export const metadata: Metadata = {
  title: "Profile | Viaro",
  robots: { index: false, follow: false },
};

/**
 * Profile & settings.
 *
 * Email and phone appear once — in "Your details" — rather than again in a separate
 * sign-in card. Saved cards are gone: Viaro does not store cards, and credit lives in
 * the Wallet. Sign out is in the sidebar.
 */
export default async function AccountPage() {
  const user = await getCurrentUser();
  // Not "render nothing": a session that expired between middleware and here
  // would otherwise show a header and footer with a blank page between them.
  if (!user) redirect("/login?next=/account");

  const isCustomer = user.role === "customer";
  const subscription = isCustomer
    ? await apiOptional<Subscription | null>("/subscriptions/me")
    : null;
  const subActive = subscription?.status === "active";

  return (
    <PageShell title="Profile" description="Your details and account settings.">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] lg:items-start">
        <div className="space-y-6">
          <Panel>
            <SectionTitle>Your details</SectionTitle>
            <p className="mt-2 text-sm text-muted-foreground">
              Your chauffeur sees your name and phone when they are driving you.
            </p>
            <div className="mt-5">
              <ProfileForm user={user} />
            </div>
            {!user.phoneVerified ? (
              <p className="mt-5 rounded-lg border border-amber-400/30 bg-amber-400/5 px-4 py-3 text-sm text-amber-100">
                Your phone number isn&rsquo;t verified yet.{" "}
                <Link href="/verify-phone" className="font-medium underline underline-offset-4">
                  Verify it now
                </Link>{" "}
                so your chauffeur can reach you.
              </p>
            ) : null}
          </Panel>

          <Panel>
            <SectionTitle>Password</SectionTitle>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              We&rsquo;ll email a secure link to {user.email} to set a new password.
            </p>
            <div className="mt-4">
              <ChangePasswordButton email={user.email} />
            </div>
          </Panel>
        </div>

        <div className="space-y-6">
          <Panel>
            <SectionTitle>Account</SectionTitle>
            <dl className="mt-5 space-y-3 text-sm">
              <div className="flex items-center justify-between gap-4">
                <dt className="text-muted-foreground">Status</dt>
                <dd>
                  <StatusBadge tone={user.status === "active" ? "success" : "warning"}>
                    {user.status === "active" ? "Active" : user.status.replace(/_/g, " ")}
                  </StatusBadge>
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Member since</dt>
                <dd className="text-cloud">{formatDate(user.createdAt)}</dd>
              </div>
              {isCustomer ? (
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-muted-foreground">Plan</dt>
                  <dd className="text-cloud">
                    {subActive ? `Monthly · ${money(subscription?.price)}` : "Pay per ride"}
                  </dd>
                </div>
              ) : null}
            </dl>
            {isCustomer ? (
              <Button asChild variant="outline" className="mt-5 w-full">
                <Link href="/subscription">{subActive ? "Manage plan" : "See the monthly plan"}</Link>
              </Button>
            ) : null}
          </Panel>

          <Panel className="border-red-500/25">
            <h2 className="text-xs font-semibold uppercase tracking-[0.08em] text-red-300">Delete account</h2>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              Permanently removes your personal details. Trip and payment records are kept,
              because they are financial history.
            </p>
            <div className="mt-4">
              <DeleteAccountButton />
            </div>
          </Panel>
        </div>
      </div>
      <LiveRefresh topics={["wallet"]} />
    </PageShell>
  );
}
