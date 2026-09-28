"use client";

import { ArrowRight, Phone, Mail, MapPin, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { send, type FormState } from "@/lib/email";
import { useActionState, useEffect, useState } from "react";
import { dictionary } from "@/lib/get-dictionary";
import { PREFILL_QUOTE_EVENT } from "@/components/Main/hero-booking-form";

const initialState: FormState = { success: false };

export function CtaSection() {
  /*
   * A package or multi-city itinerary sent from the hero widget. Bumping `prefillKey`
   * remounts the textarea so its new defaultValue actually shows.
   */
  const [prefill, setPrefill] = useState<string | null>(null);
  const [prefillKey, setPrefillKey] = useState(0);

  const [state, action, pending] = useActionState(
    async (prev: FormState, formData: FormData) => {
      const result = await send(prev, formData);
      // Once sent, a carried-over itinerary must not reappear in the reset form.
      if (result.success) setPrefill(null);
      return result;
    },
    initialState,
  );

  /*
   * Read synchronously. The dictionary is a static import, but this used to fetch it in an
   * effect and render nothing until it arrived — so the section flashed in after hydration
   * and the ?scrollTo=contact-us jump landed before it existed.
   */
  const t = (dictionary as any).cta;
  const values = state.success ? undefined : state.values;

  useEffect(() => {
    const onPrefill = (event: Event) => {
      setPrefill((event as CustomEvent<string>).detail);
      setPrefillKey((k) => k + 1);
    };
    window.addEventListener(PREFILL_QUOTE_EVENT, onPrefill);
    return () => window.removeEventListener(PREFILL_QUOTE_EVENT, onPrefill);
  }, []);

  return (
    <section id="contact-us" className="scroll-mt-24 py-12 sm:py-24 lg:py-32">
      <div className="mx-auto max-w-7xl px-5 sm:px-6 lg:px-8">
        <div className="grid gap-10 lg:grid-cols-2 lg:gap-16">
          {/* ── Left column ── */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-brand sm:text-sm">
              {t.sectionTitle}
            </p>
            <h2 className="mt-3 font-serif text-3xl font-bold leading-tight tracking-tight text-foreground sm:mt-4 sm:text-4xl lg:text-5xl">
              {t.heading}
            </h2>
            <p className="mt-4 text-base leading-relaxed text-muted-foreground sm:mt-6 sm:text-lg">
              {t.description}
            </p>

            <div className="mt-8 flex flex-col gap-5 sm:mt-10 sm:gap-6">
              {[
                { icon: Phone, href: "tel:+12066728281", ...t.info.phone },
                { icon: Mail, href: `mailto:${t.info.email.value}`, ...t.info.email },
                { icon: MapPin, href: null, ...t.info.office },
              ].map(({ icon: Icon, label, value, href }) => (
                <div key={label} className="flex items-center gap-4">
                  <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl border border-white/10">
                    <Icon className="h-5 w-5 text-brand" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs uppercase tracking-widest text-muted-foreground">{label}</p>
                    {href ? (
                      <a href={href} className="mt-1 block break-words text-foreground transition-colors hover:text-brand">
                        {value}
                      </a>
                    ) : (
                      <p className="mt-1 break-words text-foreground">{value}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* ── Right column — card ── */}
          <div className="rounded-2xl border border-white/10 bg-neutral-950 p-6 sm:p-8 lg:p-10">
            <h3 className="font-serif text-2xl font-semibold text-card-foreground">
              {t.form.title}
            </h3>
            <p className="mt-2 text-sm text-muted-foreground">{t.form.subtitle}</p>

            {state.success && (
              <div role="status" className="mt-6 flex items-start gap-2 rounded-xl border border-brand/40 bg-brand/10 px-4 py-3 text-sm text-brand">
                <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0" />
                {t.form.successMessage ?? "Thank you — your request is with our team. We'll be in touch within 2 hours."}
              </div>
            )}
            {!state.success && state.message && (
              <div role="alert" className="mt-6 flex items-start gap-2 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
                <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                {state.message}
              </div>
            )}

            <form action={action} className="mt-6 flex flex-col gap-5 sm:mt-8" noValidate>
              <div className="grid gap-5 sm:grid-cols-2">
                <Field
                  id="fullName"
                  name="fullName"
                  type="text"
                  autoComplete="name"
                  label={t.form.fields.fullName}
                  placeholder={t.form.fields.placeholders.fullName}
                  defaultValue={values?.fullName}
                  error={state.errors?.fullName?.[0]}
                />
                <Field
                  id="phone"
                  name="phone"
                  type="tel"
                  autoComplete="tel"
                  label={t.form.fields.phone}
                  placeholder={t.form.fields.placeholders.phone}
                  defaultValue={values?.phone}
                  error={state.errors?.phone?.[0]}
                />
              </div>
              <Field
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                label={t.form.fields.email}
                placeholder={t.form.fields.placeholders.email}
                defaultValue={values?.email}
                error={state.errors?.email?.[0]}
              />
              <Field
                key={`message-${prefillKey}`}
                id="message"
                name="message"
                type="textarea"
                label={t.form.fields.message}
                placeholder={t.form.fields.placeholders.message}
                defaultValue={values?.message ?? prefill ?? undefined}
                error={state.errors?.message?.[0]}
                rows={prefill ? 7 : 4}
              />

              <button
                type="submit"
                disabled={pending}
                className="flex h-14 w-full items-center justify-center rounded-full bg-primary text-xs font-semibold uppercase tracking-widest text-primary-foreground transition-colors hover:bg-brand2 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {pending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {t.form.sending ?? "Sending..."}
                  </>
                ) : (
                  <>
                    {t.form.button}
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </>
                )}
              </button>
            </form>
          </div>
        </div>
      </div>
    </section>
  );
}

function Field({
  id, name, type, label, placeholder, error, rows, defaultValue, autoComplete,
}: {
  id: string;
  name: string;
  type: "text" | "tel" | "email" | "textarea";
  label: string;
  placeholder: string;
  error?: string;
  rows?: number;
  defaultValue?: string;
  autoComplete?: string;
}) {
  const base =
    "w-full rounded-xl border bg-black px-4 py-3 text-base sm:text-sm text-foreground placeholder:text-muted-foreground focus:outline-none transition-colors " +
    (error
      ? "border-red-500 focus:border-red-400"
      : "border-white/15 focus:border-primary");
  const errorId = error ? `${id}-error` : undefined;

  return (
    <div>
      <label
        htmlFor={id}
        className="mb-2 block text-xs uppercase tracking-widest text-muted-foreground"
      >
        {label}
      </label>
      {type === "textarea" ? (
        <textarea
          id={id}
          name={name}
          rows={rows ?? 4}
          placeholder={placeholder}
          defaultValue={defaultValue}
          aria-invalid={Boolean(error)}
          aria-describedby={errorId}
          className={`${base} resize-none`}
        />
      ) : (
        <input
          id={id}
          name={name}
          type={type}
          placeholder={placeholder}
          defaultValue={defaultValue}
          autoComplete={autoComplete}
          aria-invalid={Boolean(error)}
          aria-describedby={errorId}
          className={base}
        />
      )}
      {error && (
        <p id={errorId} className="mt-1.5 flex items-center gap-1 text-xs text-red-400">
          <AlertCircle className="h-3 w-3 flex-shrink-0" />
          {error}
        </p>
      )}
    </div>
  );
}
