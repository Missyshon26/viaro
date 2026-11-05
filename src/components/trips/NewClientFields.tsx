"use client";

import type { NewClientForm } from "@/lib/newTrip";

const field =
  "mt-1 h-11 w-full rounded-field border border-border bg-surface-raised px-3 text-body text-fg outline-none focus:border-accent";
const label = "block text-label font-bold text-fg-muted";

/**
 * The details of a client who has no account yet. Nothing is saved from here: the account is
 * made when the trip is booked, so an operator never has to leave the form to add them first.
 */
export function NewClientFields({
  value,
  onChange,
  onClose,
}: {
  value: NewClientForm;
  onChange: (next: NewClientForm) => void;
  /** Shut the fields and go back to searching. */
  onClose: () => void;
}) {
  const set = (key: keyof NewClientForm, text: string) => onChange({ ...value, [key]: text });

  return (
    <div className="mt-4 rounded-field border border-border bg-surface p-4">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-meta font-bold text-fg">New client</p>
          <p className="mt-1 text-note text-fg-muted">
            Their account is created when you book this trip. They are emailed to set a password, and sent the invoice
            with a link to pay.
          </p>
        </div>
        <button type="button" onClick={onClose} className="shrink-0 text-note font-bold text-accent hover:underline">
          Search instead
        </button>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <label className={label} htmlFor="nc-first">First name</label>
          <input id="nc-first" className={field} value={value.firstName} maxLength={60} autoComplete="off" onChange={(e) => set("firstName", e.target.value)} />
        </div>
        <div>
          <label className={label} htmlFor="nc-last">Last name</label>
          <input id="nc-last" className={field} value={value.lastName} maxLength={60} autoComplete="off" onChange={(e) => set("lastName", e.target.value)} />
        </div>
        <div>
          <label className={label} htmlFor="nc-email">Email</label>
          <input id="nc-email" type="email" className={field} value={value.email} autoComplete="off" onChange={(e) => set("email", e.target.value)} />
        </div>
        <div>
          <label className={label} htmlFor="nc-phone">Phone</label>
          <input id="nc-phone" type="tel" className={field} value={value.phone} maxLength={30} autoComplete="off" onChange={(e) => set("phone", e.target.value)} />
        </div>
      </div>
    </div>
  );
}
