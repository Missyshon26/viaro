"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/TextField";
import { useAuth } from "@/lib/auth/AuthProvider";

/** Uses the same /api/auth/login route handler as the customer app. */
export function SignInForm() {
  const { login } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [showPassword, setShowPassword] = useState(false);
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!submitting) return;
    const timer = setTimeout(() => setSlow(true), 10000);
    return () => clearTimeout(timer);
  }, [submitting]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting) return;
    setSlow(false);
    setSubmitting(true);
    setError(null);

    try {
      await login(email.trim(), password);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not sign you in");
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-8 space-y-5" aria-busy={submitting}>
      <TextField
        label="Email or username"
        placeholder="you@company.com or your username"
        type="text"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        autoComplete="username"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        required
      />
      <TextField
        label="Password"
        type={showPassword ? "text" : "password"}
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        autoComplete="current-password"
        required
      />

      <button type="button" onClick={() => setShowPassword((value) => !value)} aria-pressed={showPassword} className="text-note font-medium text-accent hover:underline">{showPassword ? "Hide password" : "Show password"}</button>
      {error && <p role="alert" className="rounded-field border border-danger/25 bg-danger/5 p-3 text-note text-danger">{error}</p>}
      {slow && submitting && <p role="status" className="text-note text-fg-muted">Connecting to your workspace. The first sign-in can take up to a minute.</p>}

      <Button type="submit" variant="accent" loading={submitting}>
        Sign in
      </Button>
    </form>
  );
}
