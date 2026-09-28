"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, ErrorNote } from "@/components/app/shell";
import { createTicketAction, replyToTicketAction } from "@/lib/actions/account";
import type { FormState } from "@/lib/actions/auth";
import { TICKET_CATEGORIES } from "@/lib/api/types";

const CATEGORY_LABEL: Record<string, string> = {
  trip_dispute: "Trip dispute",
  penalty_appeal: "Penalty appeal",
  payment: "Payment",
  account: "Account",
  other: "Other",
};

export function NewTicketForm({
  defaultCategory = "other",
  defaultSubject = "",
}: {
  defaultCategory?: string;
  defaultSubject?: string;
}) {
  const [state, action, pending] = useActionState<FormState | undefined, FormData>(
    createTicketAction,
    undefined,
  );

  return (
    <form action={action} className="space-y-5">
      {state?.error ? <ErrorNote>{state.error}</ErrorNote> : null}

      <Field label="Category" htmlFor="category" error={state?.fieldErrors?.category}>
        <select
          id="category"
          name="category"
          defaultValue={
            (TICKET_CATEGORIES as readonly string[]).includes(defaultCategory) ? defaultCategory : "other"
          }
          className="flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {TICKET_CATEGORIES.map((category) => (
            <option key={category} value={category}>
              {CATEGORY_LABEL[category] ?? category}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Subject" htmlFor="subject" error={state?.fieldErrors?.subject}>
        <Input
          id="subject"
          name="subject"
          defaultValue={defaultSubject.slice(0, 200)}
          required
          minLength={3}
          maxLength={200}
        />
      </Field>

      <Field label="What happened?" htmlFor="message" error={state?.fieldErrors?.message}>
        <Textarea id="message" name="message" rows={6} required minLength={3} maxLength={4000} />
      </Field>

      <Button type="submit" size="lg" disabled={pending}>
        {pending ? "Opening…" : "Open case"}
      </Button>
    </form>
  );
}

export function ReplyForm({ ticketId }: { ticketId: string }) {
  const [state, action, pending] = useActionState<FormState | undefined, FormData>(
    replyToTicketAction,
    undefined,
  );

  return (
    <form action={action} className="space-y-4">
      {state?.error ? <ErrorNote>{state.error}</ErrorNote> : null}
      <input type="hidden" name="ticketId" value={ticketId} />
      <Textarea
        name="message"
        rows={4}
        required
        minLength={1}
        maxLength={4000}
        placeholder="Add a reply…"
      />
      <Button type="submit" disabled={pending}>
        {pending ? "Sending…" : "Send reply"}
      </Button>
    </form>
  );
}
