"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { getDictionary } from "@/lib/get-dictionary";
import { Clock, Mail, MapPin, Phone } from "lucide-react";
import { send } from "@/lib/email";

export default function ContactPage() {
  const params = useParams();
    const [dict, setDict] = useState<any>(null);
  const [form, setForm] = useState({ name: "", email: "", phone: "", service: "", message: "" });
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getDictionary().then(setDict);
  }, []);

  if (!dict) return null;

  const t = dict.contact;

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  /*
   * This used to flip to "Message Sent!" without sending anything. It now goes through
   * the same server action as the homepage quote form, so both land in the same inbox.
   */
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSending(true);

    const service = t.form.serviceOptions.find((o: any) => o.value === form.service)?.label;
    const fd = new FormData();
    fd.set("fullName", form.name);
    fd.set("email", form.email);
    // Phone is optional here but required by the shared schema.
    fd.set("phone", form.phone.trim() || "Not provided");
    fd.set("message", service ? `Service: ${service}\n\n${form.message}` : form.message);

    try {
      const result = await send({ success: false }, fd);
      if (result.success) {
        setSent(true);
      } else {
        const fieldError = Object.values(result.errors ?? {}).flat()[0];
        setError(fieldError ?? result.message ?? "Something went wrong. Please try again.");
      }
    } catch {
      setError("We couldn't send your message. Please call us on (206) 672-8281.");
    } finally {
      setSending(false);
    }
  };

  // Line icons in the brand blue, not emoji: emoji render in each platform's own colours.
  const infoCards = [
    { icon: Phone, ...t.info.phone, href: `tel:+1${t.info.phone.value.replace(/\D/g, "")}` },
    { icon: Mail, ...t.info.email, href: `mailto:${t.info.email.value}` },
    { icon: Clock, ...t.info.hours, href: null },
    { icon: MapPin, ...t.info.location, href: null },
  ];

  return (
    <div className="bg-black text-white min-h-screen">

      {/* ── HERO ── */}
      <section className="pt-32 pb-16 px-5 sm:px-8 lg:px-16 max-w-7xl mx-auto">
        <p className="text-xs font-bold uppercase tracking-widest text-primary mb-3">{t.label}</p>
        <h1 className="font-serif font-bold text-4xl sm:text-5xl lg:text-6xl leading-tight max-w-2xl mb-4">
          {t.title}
        </h1>
        <p className="text-sm sm:text-base text-neutral-400 max-w-xl leading-relaxed">{t.subtitle}</p>
      </section>

      {/* ── MAIN GRID ── */}
      <section className="pb-24 px-5 sm:px-8 lg:px-16 max-w-7xl mx-auto">
        <div className="grid gap-12 lg:grid-cols-2 lg:items-start [&>*]:min-w-0">

          {/* ── FORM ── */}
          <div className="border border-white/10 rounded-2xl bg-neutral-900/40 p-5 sm:p-8">
            {sent ? (
              <div className="flex flex-col items-center justify-center py-16 text-center gap-4">
                <div className="h-14 w-14 rounded-full bg-primary/20 border border-primary/40 flex items-center justify-center">
                  <span className="text-primary text-2xl">✓</span>
                </div>
                <h2 className="font-serif font-bold text-2xl">{t.form.successTitle}</h2>
                <p className="text-neutral-400 text-sm max-w-xs">{t.form.successText}</p>
                <button
                  onClick={() => { setSent(false); setForm({ name: "", email: "", phone: "", service: "", message: "" }); }}
                  className="mt-4 text-xs uppercase tracking-widest text-white border border-primary/40 px-6 py-2 rounded-full hover:bg-primary hover:text-black transition"
                >
                  {t.form.successBtn}
                </button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-5">
                <h2 className="font-serif font-bold text-xl mb-6">{t.form.title}</h2>

                <div>
                  <label className="block text-xs uppercase tracking-widest text-neutral-400 mb-1">
                    {t.form.name} <span className="text-primary">*</span>
                  </label>
                  <input
                    name="name" value={form.name} onChange={handleChange} required
                    placeholder={t.form.namePlaceholder}
                    className="w-full bg-black border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-neutral-600 focus:outline-none focus:border-primary transition"
                  />
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="block text-xs uppercase tracking-widest text-neutral-400 mb-1">
                      {t.form.email} <span className="text-primary">*</span>
                    </label>
                    <input
                      name="email" type="email" value={form.email} onChange={handleChange} required
                      placeholder={t.form.emailPlaceholder}
                      className="w-full bg-black border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-neutral-600 focus:outline-none focus:border-primary transition"
                    />
                  </div>
                  <div>
                    <label className="block text-xs uppercase tracking-widest text-neutral-400 mb-1">{t.form.phone}</label>
                    <input
                      name="phone" type="tel" value={form.phone} onChange={handleChange}
                      placeholder={t.form.phonePlaceholder}
                      className="w-full bg-black border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-neutral-600 focus:outline-none focus:border-primary transition"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs uppercase tracking-widest text-neutral-400 mb-1">{t.form.service}</label>
                  <select
                    name="service" value={form.service} onChange={handleChange}
                    className="w-full bg-black border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-primary transition"
                  >
                    <option value="">{t.form.serviceDefault}</option>
                    {t.form.serviceOptions.map((o: any) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs uppercase tracking-widest text-neutral-400 mb-1">
                    {t.form.message} <span className="text-primary">*</span>
                  </label>
                  <textarea
                    name="message" value={form.message} onChange={handleChange} required rows={5}
                    placeholder={t.form.messagePlaceholder}
                    className="w-full bg-black border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-neutral-600 focus:outline-none focus:border-primary transition resize-none"
                  />
                </div>

                {error ? (
                  <p role="alert" className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
                    {error}
                  </p>
                ) : null}

                <button type="submit" disabled={sending}
                  className="w-full bg-primary text-white font-bold py-3 rounded-full text-xs uppercase tracking-widest hover:bg-brand2 transition disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {sending ? "Sending…" : t.form.submit}
                </button>
              </form>
            )}
          </div>

          {/* ── INFO ── */}
          <div className="space-y-6">
            {infoCards.map((card) => (
              <div key={card.label} className="flex gap-4 border border-white/5 rounded-2xl bg-neutral-900/30 p-5 sm:p-6 hover:border-primary/30 transition group">
                <div className="flex-shrink-0 h-10 w-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center group-hover:bg-primary/20 transition">
                  <card.icon className="h-[18px] w-[18px] text-brand" />
                </div>
                <div className="min-w-0 [overflow-wrap:anywhere]">
                  <p className="text-xs uppercase tracking-widest text-neutral-400 mb-1">{card.label}</p>
                  {card.href ? (
                    <a href={card.href} className="text-white font-semibold hover:text-primary transition">{card.value}</a>
                  ) : (
                    <p className="text-white font-semibold">{card.value}</p>
                  )}
                  <p className="text-xs text-neutral-400 mt-0.5">{card.note}</p>
                </div>
              </div>
            ))}

            {/* Social */}
            <div className="border border-white/5 rounded-2xl bg-neutral-900/30 p-6">
              <p className="text-xs uppercase tracking-widest text-neutral-400 mb-4">{t.social.label}</p>
              <div className="flex gap-3 flex-wrap">
                {t.social.links.map((s: any) => (
                  <a key={s.label} href={s.href} target="_blank" rel="noopener noreferrer"
                    className="text-xs font-semibold uppercase tracking-widest border border-white/10 rounded-full px-4 py-2 text-neutral-400 hover:border-primary hover:text-primary transition"
                  >
                    {s.label}
                  </a>
                ))}
              </div>
            </div>
          </div>

        </div>
      </section>
    </div>
  );
}