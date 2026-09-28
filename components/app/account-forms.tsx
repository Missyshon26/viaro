"use client";

import { useActionState, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/app/shell";
import {
  updateProfileAction,
  deleteAccountAction,
  removePaymentMethodAction,
} from "@/lib/actions/account";
import { logoutAction, forgotPasswordAction } from "@/lib/actions/auth";
import type { FormState } from "@/lib/actions/auth";
import type { User } from "@/lib/api/types";

/**
 * Name and phone, the two things a passenger can change themselves.
 *
 * Controlled, with a plain onSubmit (preventDefault + a transition) rather than a form
 * `action`: React 19 resets a form after its action runs, which snapped the fields back
 * to the values the page was rendered with — so a successful save looked like it had
 * been undone until the page re-rendered. Feedback is a toast either way.
 */
export function ProfileForm({ user }: { user: User }) {
  const router = useRouter();
  const [name, setName] = useState(user.name);
  const [phone, setPhone] = useState(user.phone ?? "");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string | undefined>>({});
  const [pending, start] = useTransition();
  const dirty = name.trim() !== user.name || phone.trim() !== (user.phone ?? "");

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData();
    formData.set("name", name.trim());
    formData.set("phone", phone.trim());
    start(async () => {
      const result = await updateProfileAction(undefined, formData);
      setFieldErrors(result.fieldErrors ?? {});
      if (result.saved) {
        toast.success("Your details were saved");
        router.refresh();
      } else {
        toast.error(result.error ?? "We couldn't save your changes. Please try again.");
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5" noValidate>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Full name" htmlFor="name" error={fieldErrors.name}>
          <Input
            id="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="name"
            required
            minLength={2}
          />
        </Field>
        <Field
          label="Phone"
          htmlFor="phone"
          error={fieldErrors.phone}
          hint={user.phoneVerified ? "Verified" : undefined}
        >
          <Input
            id="phone"
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            autoComplete="tel"
            required
          />
        </Field>
      </div>

      {/* Email is not editable: PATCH /users/me accepts name and phone only. */}
      <Field label="Email" htmlFor="email">
        <Input id="email" value={user.email} disabled readOnly />
      </Field>
      <p className="-mt-2 text-xs text-muted-foreground">
        To change your email,{" "}
        <Link href="/support/new?category=account&subject=Change%20my%20email" className="text-azure underline underline-offset-4">
          contact support
        </Link>
        .
      </p>

      <div className="flex items-center gap-4">
        <Button type="submit" disabled={pending || !dirty}>
          {pending ? "Saving…" : "Save changes"}
        </Button>
        {!dirty && !pending ? (
          <span className="text-xs text-muted-foreground">No unsaved changes</span>
        ) : null}
      </div>
    </form>
  );
}

export function SignOutButton() {
  const [pending, start] = useTransition();
  return (
    <Button
      variant="outline"
      onClick={() => start(() => void logoutAction())}
      disabled={pending}
    >
      {pending ? "Signing out…" : "Sign out"}
    </Button>
  );
}

/**
 * Two deliberate steps: open the confirmation, then type DELETE. Styled destructive from
 * the first press — it used to be an ordinary outline button, indistinguishable from
 * "Sign out" at a glance.
 */
export function DeleteAccountButton() {
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState("");
  const [pending, start] = useTransition();
  const ready = typed.trim().toUpperCase() === "DELETE";

  if (!confirming) {
    return (
      <Button
        variant="outline"
        className="border-red-500/50 text-red-300 hover:bg-red-500/10 hover:text-red-200"
        onClick={() => setConfirming(true)}
      >
        Delete my account
      </Button>
    );
  }

  return (
    <div className="space-y-4 rounded-lg border border-red-500/40 bg-red-500/5 p-4">
      <p className="text-sm font-medium text-red-200">This cannot be undone.</p>
      <p className="text-sm leading-relaxed text-muted-foreground">
        Your name, email and phone are erased and you are signed out everywhere. Any
        wallet credit can no longer be used. Trip and payment records are kept as
        financial history.
      </p>
      <Field label='Type "DELETE" to confirm' htmlFor="confirm-delete">
        <Input
          id="confirm-delete"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          autoComplete="off"
          disabled={pending}
        />
      </Field>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="outline"
          onClick={() => {
            setConfirming(false);
            setTyped("");
          }}
          disabled={pending}
        >
          Keep my account
        </Button>
        <Button
          variant="destructive"
          disabled={!ready || pending}
          onClick={() =>
            start(async () => {
              const result = await deleteAccountAction();
              if (result?.error) toast.error(result.error);
            })
          }
        >
          {pending ? "Deleting…" : "Permanently delete"}
        </Button>
      </div>
    </div>
  );
}

export function RemoveCardButton({ id }: { id: string }) {
  const [pending, start] = useTransition();
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => start(() => void removePaymentMethodAction(id))}
      disabled={pending}
    >
      {pending ? "Removing…" : "Remove"}
    </Button>
  );
}

/**
 * Password change, via the reset flow.
 *
 * There is no "change my password" endpoint — the API exposes only
 * POST /auth/password/forgot (emails a link) and /auth/password/reset (consumes the
 * token). So this triggers the same flow a signed-out user gets, which is arguably the
 * safer design anyway: changing a password should prove control of the mailbox, not just
 * of an open tab.
 *
 * The response is deliberately identical whether or not the address exists — the API
 * always answers success to prevent account enumeration — so the copy says "if we have
 * an account" rather than claiming an email was definitely sent.
 */
export function ChangePasswordButton({ email }: { email: string }) {
  const [state, formAction, pending] = useActionState<
    (FormState & { sent?: boolean }) | undefined,
    FormData
  >(forgotPasswordAction, undefined);

  if (state?.sent) {
    return (
      <p className="rounded-lg border border-brand/40 bg-brand/5 px-4 py-3 text-sm text-foreground">
        Check <span className="font-medium">{email}</span> for a link to set a new
        password. It expires in an hour.
      </p>
    );
  }

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="email" value={email} />
      {state?.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
      <Button type="submit" variant="outline" disabled={pending}>
        {pending ? "Sending…" : "Email me a reset link"}
      </Button>
    </form>
  );
}
