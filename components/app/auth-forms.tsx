"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, ErrorNote } from "@/components/app/shell";
import {
  loginAction,
  registerAction,
  forgotPasswordAction,
  resetPasswordAction,
  type FormState,
} from "@/lib/actions/auth";

/**
 * Client components only because they need `useActionState` for pending/error state.
 * The submit itself is a Server Action — no fetch, and no token ever touches the
 * browser.
 */

export function LoginForm() {
  const params = useSearchParams();
  const next = params.get("next") ?? "";
  const justReset = params.get("reset") === "1";
  const [state, action, pending] = useActionState<FormState | undefined, FormData>(
    loginAction,
    undefined,
  );

  return (
    <form action={action} className="space-y-5">
      {justReset ? (
        <p className="rounded-lg border border-brand/40 bg-brand/10 px-4 py-3 text-sm text-foreground">
          Password updated. Sign in with your new password.
        </p>
      ) : null}
      {state?.error ? <ErrorNote>{state.error}</ErrorNote> : null}

      <input type="hidden" name="next" value={next} />

      <Field label="Email" htmlFor="email" error={state?.fieldErrors?.email}>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          defaultValue={state?.values?.email}
          required
        />
      </Field>

      <Field label="Password" htmlFor="password" error={state?.fieldErrors?.password}>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
      </Field>

      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </Button>

      <div className="flex items-center justify-between text-sm">
        <Link href="/forgot-password" className="text-brand hover:underline">
          Forgot password?
        </Link>
        <Link href="/register" className="text-muted-foreground hover:text-foreground">
          Create an account
        </Link>
      </div>
    </form>
  );
}

export function RegisterForm() {
  const [state, action, pending] = useActionState<FormState | undefined, FormData>(
    registerAction,
    undefined,
  );

  return (
    <form action={action} className="space-y-5">
      {state?.error ? <ErrorNote>{state.error}</ErrorNote> : null}

      <Field label="Full name" htmlFor="name" error={state?.fieldErrors?.name}>
        <Input
          id="name"
          name="name"
          autoComplete="name"
          defaultValue={state?.values?.name}
          required
          minLength={2}
        />
      </Field>

      <Field label="Email" htmlFor="email" error={state?.fieldErrors?.email}>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          defaultValue={state?.values?.email}
          required
        />
      </Field>

      <Field
        label="Phone"
        htmlFor="phone"
        error={state?.fieldErrors?.phone}
        hint="Include the country code, e.g. +1 206 555 0148"
      >
        <Input
          id="phone"
          name="phone"
          type="tel"
          autoComplete="tel"
          defaultValue={state?.values?.phone}
          required
        />
      </Field>

      <Field
        label="Password"
        htmlFor="password"
        error={state?.fieldErrors?.password}
        hint="At least 8 characters."
      >
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
        />
      </Field>

      {/* The API only accepts customer self-signup here; drivers are onboarded by a
          company or the platform, so the role is fixed rather than offered. */}
      <input type="hidden" name="role" value="customer" />

      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? "Creating your account…" : "Create account"}
      </Button>

      <p className="text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link href="/login" className="text-brand hover:underline">
          Sign in
        </Link>
      </p>
    </form>
  );
}

export function ForgotPasswordForm() {
  const [state, action, pending] = useActionState<
    (FormState & { sent?: boolean; email?: string }) | undefined,
    FormData
  >(forgotPasswordAction, undefined);
  const noAccount = Boolean(state?.error && /no account/i.test(state.error));

  if (state?.sent) {
    return (
      <div className="space-y-5 text-center">
        <p className="text-sm leading-relaxed text-muted-foreground">
          We sent a reset link to <strong className="text-foreground">{state.email}</strong>.
          It expires in 30 minutes — check your spam folder if it hasn&apos;t arrived.
        </p>
        <Button asChild variant="outline" className="w-full">
          <Link href="/login">Back to sign in</Link>
        </Button>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-5">
      {state?.error ? (
        <ErrorNote>
          {state.error}
          {noAccount ? (
            <>
              {" "}
              <Link href="/register" className="underline">
                Create an account
              </Link>
            </>
          ) : null}
        </ErrorNote>
      ) : null}
      <Field label="Email" htmlFor="email" error={state?.fieldErrors?.email}>
        <Input id="email" name="email" type="email" autoComplete="email" required defaultValue={state?.email} />
      </Field>
      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? "Sending…" : "Send reset link"}
      </Button>
      <p className="text-center text-sm">
        <Link href="/login" className="text-muted-foreground hover:text-foreground">
          Back to sign in
        </Link>
      </p>
    </form>
  );
}

export function ResetPasswordForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState<FormState | undefined, FormData>(
    resetPasswordAction,
    undefined,
  );

  if (!token) {
    return (
      <ErrorNote>
        This reset link is missing its token. Request a new one from the{" "}
        <Link href="/forgot-password" className="underline">
          forgot password
        </Link>{" "}
        page.
      </ErrorNote>
    );
  }

  return (
    <form action={action} className="space-y-5">
      {state?.error ? <ErrorNote>{state.error}</ErrorNote> : null}
      <input type="hidden" name="token" value={token} />

      <Field
        label="New password"
        htmlFor="password"
        error={state?.fieldErrors?.password}
        hint="At least 8 characters."
      >
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
        />
      </Field>

      <Field
        label="Confirm password"
        htmlFor="confirmPassword"
        error={state?.fieldErrors?.confirmPassword}
      >
        <Input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
        />
      </Field>

      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? "Updating…" : "Update password"}
      </Button>
    </form>
  );
}
