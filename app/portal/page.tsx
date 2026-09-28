import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { PageShell, Panel, SectionTitle } from "@/components/app/shell";
import { SignOutButton } from "@/components/app/account-forms";
import { getCurrentUser } from "@/lib/auth/current-user";

export const metadata: Metadata = {
  title: "Your portal | Viaro",
  robots: { index: false, follow: false },
};

/**
 * Hand-off for non-passenger accounts.
 *
 * This site is the passenger product; chauffeurs, the platform admin and fleet
 * operators each have their own application. A valid session for one of those roles is
 * not an error — it just belongs somewhere else, and this says where instead of
 * dropping them on a customer screen that would 403 on every request.
 */
const PORTALS = {
  driver: {
    title: "Chauffeur portal",
    body: "Your trips, availability, earnings and documents live in the driver app.",
    url: process.env.NEXT_PUBLIC_DRIVER_URL,
  },
  admin: {
    title: "Platform operations",
    body: "Dashboards, city pricing, dispatch and support triage live in the operations app.",
    url: process.env.NEXT_PUBLIC_ADMIN_URL,
  },
  company: {
    title: "Fleet operations",
    body: "Your driver roster, payout terms and revenue live in the operations app.",
    url: process.env.NEXT_PUBLIC_ADMIN_URL,
  },
} as const;

export default async function PortalPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role === "customer") redirect("/account");

  const portal = PORTALS[user.role];

  return (
    <PageShell
      title={`Hello, ${user.name.split(" ")[0]}`}
      description="You are signed in, but this site is the passenger product."
      action={<SignOutButton />}
    >
      <Panel className="max-w-2xl">
        <SectionTitle>{portal.title}</SectionTitle>
        <p className="mt-4 text-sm leading-relaxed text-muted-foreground">{portal.body}</p>

        <div className="mt-6 flex flex-wrap gap-3">
          {portal.url ? (
            <Button asChild>
              {/* Separate deployment, so a plain anchor rather than a client-side link. */}
              <a href={portal.url}>Go to {portal.title.toLowerCase()}</a>
            </Button>
          ) : (
            <p className="text-sm text-muted-foreground">
              The address for that app is not configured yet — set{" "}
              <code className="text-foreground">
                {user.role === "driver" ? "NEXT_PUBLIC_DRIVER_URL" : "NEXT_PUBLIC_ADMIN_URL"}
              </code>{" "}
              in this project&apos;s environment.
            </p>
          )}
          <Button asChild variant="outline">
            <Link href="/">Back to the public site</Link>
          </Button>
        </div>
      </Panel>
    </PageShell>
  );
}
