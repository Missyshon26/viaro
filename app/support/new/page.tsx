import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageShell, Panel } from "@/components/app/shell";
import { NewTicketForm } from "@/components/app/support-forms";
import { SUPPORT_PHONE, SUPPORT_PHONE_HREF } from "@/lib/constants";

export const metadata: Metadata = {
  title: "Open a case | Viaro",
  robots: { index: false, follow: false },
};

export default async function NewTicketPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string; subject?: string }>;
}) {
  // Pre-filled when arriving from a link such as Profile's "contact support to change
  // your email".
  const { category, subject } = await searchParams;

  return (
    <PageShell
      title="Open a case"
      description="A charge you disagree with, a no-show, a lost item — a person reads every case and replies in writing."
      action={
        <Button asChild variant="outline">
          <Link href="/support">
            <ArrowLeft className="mr-2 h-4 w-4" />
            All cases
          </Link>
        </Button>
      }
    >
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] lg:items-start">
        <Panel>
          <NewTicketForm defaultCategory={category} defaultSubject={subject} />
        </Panel>
        <Panel>
          <p className="font-medium text-cloud">Is it about a ride today?</p>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Don&rsquo;t wait for a written reply — call{" "}
            <a href={SUPPORT_PHONE_HREF} className="text-cloud underline underline-offset-4">
              {SUPPORT_PHONE}
            </a>{" "}
            and a dispatcher will sort it out now.
          </p>
        </Panel>
      </div>
    </PageShell>
  );
}
