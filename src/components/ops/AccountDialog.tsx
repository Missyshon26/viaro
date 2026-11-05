"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { IconClose } from "@/components/ui/Icons";
import { errorText } from "@/lib/api/client";
import { createClient, updateClient } from "@/lib/api/clients";
import {
  createPayload,
  emptyClientForm,
  formFromClient,
  updatePayload,
  type ClientFormValues,
  type ClientLike,
} from "@/lib/clients";

/**
 * The form for adding a client and for correcting an account's details: name, email, phone,
 * address and status. Shared by the clients screen and the users screen, so both behave alike.
 * It never shows or sets a password.
 */
export function AccountDialog({
  client,
  onClose,
  onSaved,
  noun = "client",
  saveChanges = updateClient,
}: {
  /** The account being edited, or null to add a client. */
  client: (ClientLike & { _id: string; name: string }) | null;
  onClose: () => void;
  onSaved: (message: string) => Promise<void>;
  /** What the account is called in the wording: "client" on the clients screen, "user" on the users screen. */
  noun?: string;
  /** How the changes are saved: the clients endpoint by default, the any-role users endpoint for the users screen. */
  saveChanges?: (id: string, changes: Record<string, unknown>) => Promise<{ name: string }>;
}) {
  const isNew = client === null;
  const [form, setForm] = useState<ClientFormValues>(() => (client ? formFromClient(client) : emptyClientForm()));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const set = <K extends keyof ClientFormValues>(key: K, value: ClientFormValues[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  // Suspending locks someone out of their account, so it is confirmed before it is sent.
  const [confirmSuspend, setConfirmSuspend] = useState(false);
  const suspending = !isNew && form.status === "suspended" && client.status !== "suspended";

  function save(event: React.FormEvent) {
    event.preventDefault();
    if (suspending) {
      setConfirmSuspend(true);
      return;
    }
    void commit();
  }

  async function commit() {
    setSaving(true);
    setError(null);
    try {
      if (isNew) {
        const { user, inviteSent } = await createClient(createPayload(form));
        await onSaved(
          !form.sendInvite
            ? `${user.name} was added. No invitation was sent.`
            : inviteSent
              ? `${user.name} was added, and an email is on its way to set their password.`
              : `${user.name} was added, but the invitation email could not be sent. They can use "Forgot password" on the booking site.`,
        );
      } else {
        const changes = updatePayload(form, client);
        if (Object.keys(changes).length === 0) {
          onClose();
          return;
        }
        const user = await saveChanges(client._id, changes);
        await onSaved(
          changes.status === "suspended"
            ? `${user.name} was suspended and signed out.`
            : `${user.name} was updated.`,
        );
      }
    } catch (err) {
      setError(errorText(err, `Could not save that ${noun}`));
      setSaving(false);
      // The error is shown in the form behind; close the question so it can be read.
      setConfirmSuspend(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={isNew ? "Add a client" : `Edit ${client.name}`}
      className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center"
    >
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-panel/50 backdrop-blur-[2px]"
      />

      <form
        onSubmit={save}
        className="relative flex max-h-[90dvh] w-full max-w-lg flex-col overflow-hidden rounded-card border border-border bg-surface-raised shadow-[var(--shadow-raised)]"
      >
        <div className="flex items-center gap-3 border-b border-border-subtle px-5 py-4">
          <h2 className="text-action font-bold text-fg">{isNew ? "Add a client" : client.name}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="ml-auto inline-flex h-8 w-8 items-center justify-center rounded-full text-fg-muted hover:bg-surface hover:text-fg"
          >
            <IconClose size={16} />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {error ? (
            <p className="rounded-field border border-danger/30 bg-danger/5 px-3.5 py-2.5 text-note font-bold text-danger">
              {error}
            </p>
          ) : null}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Box label="First name">
              <input
                value={form.firstName}
                onChange={(e) => set("firstName", e.target.value)}
                required
                maxLength={60}
                autoFocus
                className={inputCls}
              />
            </Box>
            <Box label="Last name">
              <input
                value={form.lastName}
                onChange={(e) => set("lastName", e.target.value)}
                maxLength={60}
                className={inputCls}
              />
            </Box>
          </div>

          <Box
            label="Email"
            hint={isNew ? "They sign in with this." : "Changing it changes how they sign in."}
          >
            <input
              type="email"
              value={form.email}
              onChange={(e) => set("email", e.target.value)}
              required
              className={inputCls}
            />
          </Box>

          <Box label="Phone" hint={isNew ? undefined : "A new number needs to be verified again."}>
            <input
              type="tel"
              value={form.phone}
              onChange={(e) => set("phone", e.target.value)}
              required
              minLength={6}
              className={inputCls}
            />
          </Box>

          <fieldset className="space-y-3 rounded-field border border-border p-3.5">
            <legend className="px-1 text-note font-medium uppercase tracking-wider text-fg-muted">
              Address (optional)
            </legend>
            <Box label="Street address">
              <input value={form.line1} onChange={(e) => set("line1", e.target.value)} className={inputCls} />
            </Box>
            <Box label="Apartment, suite, etc.">
              <input value={form.line2} onChange={(e) => set("line2", e.target.value)} className={inputCls} />
            </Box>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Box label="City">
                <input value={form.city} onChange={(e) => set("city", e.target.value)} className={inputCls} />
              </Box>
              <Box label="State">
                <input value={form.state} onChange={(e) => set("state", e.target.value)} className={inputCls} />
              </Box>
              <Box label="Postal code">
                <input
                  value={form.postalCode}
                  onChange={(e) => set("postalCode", e.target.value)}
                  className={inputCls}
                />
              </Box>
            </div>
            <p className="text-note text-fg-muted">
              Street, city, state and postal code go together; leave all of them blank for no address.
            </p>
          </fieldset>

          {isNew ? (
            <label className="flex items-start gap-2.5 rounded-field border border-border bg-surface px-3.5 py-3">
              <input
                type="checkbox"
                checked={form.sendInvite}
                onChange={(e) => set("sendInvite", e.target.checked)}
                className="mt-0.5 h-4 w-4 accent-[var(--accent)]"
              />
              <span className="text-meta text-fg">
                Email them a link to set their password
                <span className="block text-note text-fg-muted">
                  You never see or set a password. Untick for a client who will not use the site.
                </span>
              </span>
            </label>
          ) : (
            <Box
              label="Account status"
              hint="Suspending signs them out everywhere and stops them signing in until reinstated."
            >
              <select
                value={form.status}
                onChange={(e) => set("status", e.target.value as ClientFormValues["status"])}
                className={inputCls}
              >
                <option value="active">Active</option>
                <option value="suspended">Suspended</option>
                {client.status === "pending_documents" ? <option value="pending_documents">Pending documents</option> : null}
              </select>
            </Box>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border-subtle px-5 py-3">
          <Button type="button" variant="secondary" block={false} onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" block={false} loading={saving}>
            {isNew ? "Add client" : "Save changes"}
          </Button>
        </div>

        <ConfirmDialog
          open={confirmSuspend}
          title={`Suspend ${client?.name ?? `this ${noun}`}?`}
          confirmLabel="Suspend and sign out"
          pendingLabel="Suspending…"
          danger
          pending={saving}
          onConfirm={() => void commit()}
          onCancel={() => setConfirmSuspend(false)}
        >
          <p>They will be signed out everywhere straight away and cannot sign in until you reinstate them.</p>
          <p>Their bookings, wallet and history are kept. Trips already booked are not cancelled.</p>
        </ConfirmDialog>
      </form>
    </div>
  );
}

const inputCls =
  "h-10 w-full rounded-field border border-border bg-surface px-3 text-meta text-fg placeholder:text-fg-muted focus:border-accent focus:outline-none";

/** The input sits INSIDE the label, so clicking the text focuses it and screen readers announce it. */
function Box({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block">
        <span className="block text-note font-medium uppercase tracking-wider text-fg-muted">{label}</span>
        <span className="mt-1.5 block">{children}</span>
      </label>
      {hint ? <p className="mt-1.5 text-note text-fg-muted">{hint}</p> : null}
    </div>
  );
}
