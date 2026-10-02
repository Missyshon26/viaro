"use client";

import { useActionState, useState, useTransition } from "react";
import { formatPhone } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, ErrorNote } from "@/components/app/shell";
import { sendPhoneCodeAction, verifyPhoneAction } from "@/lib/actions/auth";
import type { FormState } from "@/lib/actions/auth";

export function VerifyPhoneForm({ phone }: { phone: string }) {
  const [sending, startSend] = useTransition();
  const [sent, setSent] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [state, action, pending] = useActionState<FormState | undefined, FormData>(
    verifyPhoneAction,
    undefined,
  );

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        {sendError ? <ErrorNote>{sendError}</ErrorNote> : null}
        <p className="text-sm leading-relaxed text-muted-foreground">
          We&apos;ll text a six-digit code to <span className="text-foreground">{formatPhone(phone)}</span>.
          It expires in 10 minutes.
        </p>
        <Button
          variant={sent ? "outline" : "default"}
          disabled={sending}
          onClick={() =>
            startSend(async () => {
              const result = await sendPhoneCodeAction();
              setSendError(result?.error ?? null);
              setSent(Boolean(result?.sent));
            })
          }
        >
          {sending ? "Sending…" : sent ? "Send another code" : "Send code"}
        </Button>
        {sent ? <p className="text-sm text-brand">Code sent.</p> : null}
      </div>

      <form action={action} className="space-y-5 border-t border-border pt-6">
        {state?.error ? <ErrorNote>{state.error}</ErrorNote> : null}
        <Field
          label="Six-digit code"
          htmlFor="code"
          error={state?.fieldErrors?.code}
          hint="Five wrong attempts and the code is voided."
        >
          <Input
            id="code"
            name="code"
            inputMode="numeric"
            pattern="\d{6}"
            maxLength={6}
            placeholder="000000"
            autoComplete="one-time-code"
            required
            // Wide spacing so a six-digit code reads digit by digit.
            className="h-12 max-w-[14rem] text-lg tracking-[0.5em]"
          />
        </Field>
        <Button type="submit" disabled={pending}>
          {pending ? "Verifying…" : "Verify phone"}
        </Button>
      </form>
    </div>
  );
}
