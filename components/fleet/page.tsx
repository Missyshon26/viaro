"use client";

import Image from "next/image";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { getDictionary } from "@/lib/get-dictionary";
import { FleetFa } from "@/data/Fa";
import { FleetTestimonials } from "@/data/Tetimonials";
import { Testimonials } from "../testimonials";
import { FA } from "../FA";
import { Button } from "@/components/ui/button";
import { ArrowRight, Phone } from "lucide-react";

const btnPrimary =
  "bg-primary text-white hover:bg-brand2 rounded-full uppercase tracking-widest text-xs font-semibold transition-colors";

const TRUST_METRICS = [
  {
    value: "60,000+",
    label: { en: "Trips Completed", es: "Viajes Completados" },
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        width={28}
        height={28}
      >
        <path d="M9 17H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2v3" />
        <circle cx="17" cy="17" r="4" />
        <path d="m21 21-1.5-1.5M17 15v2l1 1" />
        <path d="m9 11 2 2 4-4" />
      </svg>
    ),
  },

  {
    value: "24/7",
    label: { en: "Customer Support", es: "Atención al Cliente" },
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        width={28}
        height={28}
      >
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        <path d="M12 7v2M12 13h.01" />
      </svg>
    ),
  },
  {
    value: "BBB",
    label: { en: "Verified", es: "Verificado" },
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        width={28}
        height={28}
      >
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        <path d="m9 12 2 2 4-4" />
      </svg>
    ),
  },
  {
    value: "5-Star",
    label: { en: "Rating", es: "Calificación" },
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        width={28}
        height={28}
      >
        <path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z" />
      </svg>
    ),
  },
];

export default function FleetContent() {
  const params = useParams();
    const [dict, setDict] = useState<any>(null);

  useEffect(() => {
    getDictionary().then(setDict);
  }, []);

  const fa = FleetFa;
  const testimonials = FleetTestimonials;

  if (!dict) return null;
  const t = dict.fleet;

  return (
    <main className="bg-black text-white">
      <section
        className="relative flex min-h-[100dvh] w-full flex-col justify-end overflow-hidden"
      >
        <Image
          src="/images/FleetHero.png"
          alt={t.hero.imageAlt}
          fill
          priority
          className="object-cover object-center"
          sizes="100vw"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black via-black/70 to-black/30" />

        <div className="relative z-10 mx-auto w-full max-w-7xl px-5 sm:px-8 lg:px-16 pt-28 pb-24 sm:pb-20">
          <div>
            <p className="mb-3 text-xs sm:text-sm font-semibold uppercase tracking-[0.08em] text-brand">
              {t.hero.eyebrow}
            </p>
            <h1 className="font-serif font-bold leading-[1.1] text-[1.6rem] xs:text-3xl sm:text-4xl lg:text-5xl xl:text-6xl max-w-[280px] xs:max-w-sm sm:max-w-2xl lg:max-w-3xl">
              {t.hero.title}
            </h1>
            <h2 className="mt-3 max-w-xl text-[0.95rem] leading-relaxed text-white/85 sm:text-lg [text-shadow:0_1px_3px_rgba(0,0,0,0.85)]">
              {t.hero.subtitle}
            </h2>

            <div className="mt-5 sm:mt-8 flex flex-wrap gap-3">
              <a href="/book">
                <Button className={`px-6 sm:px-8 h-auto min-h-11 sm:min-h-12 py-2.5 max-w-full whitespace-normal text-center leading-snug ${btnPrimary}`}>
                  {t.hero.ctaBook}
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </a>
              <a href="tel:2066728281">
                <Button
                  variant="outline"
                  className="rounded-full px-6 sm:px-8 uppercase tracking-widest text-xs font-semibold h-auto min-h-11 sm:min-h-12 py-2.5 max-w-full whitespace-normal text-center leading-snug border-white text-white hover:bg-white hover:text-black"
                >
                  <Phone className="mr-2 h-4 w-4" />
                  (206) 672-8281
                </Button>
              </a>
            </div>

            {t.hero.description && (
              <p className="mt-5 max-w-2xl text-[0.95rem] leading-relaxed text-white/85 sm:text-lg [text-shadow:0_1px_3px_rgba(0,0,0,0.85)]">
                "{t.hero.description}"
              </p>
            )}
          </div>
        </div>
      </section>
      {/* ── TRUST METRICS ── */}
<section
  style={{
    background: "rgb(30,30,30)",
    borderTop: "1px solid rgba(255,255,255,0.1)",
    borderBottom: "1px solid rgba(255,255,255,0.1)",
    padding: "40px 16px",
  }}
>
  <style>{`
    .trust-label { font-size: 11px; }
    .trust-value { font-size: 22px; }
    .trust-icon svg { width: 28px; height: 28px; }
    .trust-heading { font-size: 11px; }
    @media (max-width: 480px) {
      .trust-label { font-size: 11px; }
      .trust-value { font-size: 16px; }
      .trust-icon svg { width: 20px; height: 20px; }
      .trust-heading { font-size: 11px; }
    }
  `}</style>

  <p
    className="trust-heading"
    style={{
      textAlign: "center",
      textTransform: "uppercase",
      letterSpacing: "0.15em",
      color: "rgba(255,255,255,0.7)",
      marginBottom: 32,
      fontWeight: 500,
    }}
  >
    {"Trusted by thousands across North America"}
  </p>

  <div
    style={{
      maxWidth: 900,
      margin: "0 auto",
      display: "grid",
      gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
      gap: 24,
      textAlign: "center",
    }}
  >
    {TRUST_METRICS.map((m) => (
      <div
        key={m.value}
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 10,
        }}
      >
        <div className="trust-icon" style={{ color: "#89b4d4" }}>
          {m.icon}
        </div>
        <span
          className="trust-value"
          style={{
            fontWeight: 700,
            color: "#fff",
            lineHeight: 1,
          }}
        >
          {m.value}
        </span>
        <span
          className="trust-label"
          style={{
            color: "rgba(255,255,255,0.7)",
            textTransform: "uppercase",
            letterSpacing: "0.08em",
          }}
        >
          {m.label.en}
        </span>
      </div>
    ))}
  </div>
</section>
      {/* ── FLEET CARDS ── */}
      <section className="py-12 sm:py-24 bg-black">
        <div className="mx-auto max-w-7xl px-5 sm:px-8 lg:px-16">
          <p className="text-xs font-bold uppercase tracking-widest text-primary mb-3">
            {t.fleet.label}
          </p>
          <h2 className="font-serif font-bold text-3xl sm:text-4xl lg:text-5xl leading-tight mb-3">
            {t.fleet.title}
          </h2>
          <h3 className="text-base sm:text-lg text-white/60 mb-10">
            {t.fleet.subtitle}
          </h3>

          {/* Interior image */}
          <div className="relative w-full aspect-video sm:aspect-[21/9] rounded-2xl overflow-hidden mb-12">
            <Image
              src="/images/FleetInterior.png"
              alt={t.fleet.interiorAlt}
              fill
              className="object-cover"
              sizes="(max-width: 640px) 100vw, 80vw"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent flex items-end p-6">
              <p className="text-sm text-white/80 italic">
                {t.fleet.interiorCaption}
              </p>
            </div>
          </div>

          <p className="text-sm sm:text-base text-neutral-400 leading-relaxed mb-10 max-w-3xl">
            {t.fleet.intro}
          </p>

          {/* Vehicle Cards */}
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {t.fleet.vehicles.map((v: any, i: number) => (
              <div
                key={i}
                className="flex flex-col border border-white/10 rounded-2xl bg-neutral-900/40 overflow-hidden hover:border-primary/50 hover:bg-neutral-900/70 transition-all duration-300"
              >
                <div className="relative w-full aspect-[3/2]">
                  <Image
                    src={v.image}
                    alt={v.imageAlt}
                    fill
                    className="object-cover"
                    sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                  />
                </div>
                <div className="p-6 flex flex-col gap-3 flex-1">
                  <div className="h-px w-10 bg-primary" />
                  <h3 className="font-serif font-bold text-xl">{v.title}</h3>
                  <ul className="text-sm text-neutral-400 space-y-1">
                    <li>{v.passengers}</li>
                    <li>{v.luggage}</li>
                    <li className="text-white/70 text-sm italic">{v.models}</li>
                  </ul>
                  <p className="text-sm text-neutral-400 leading-relaxed mt-1">
                    {v.description}
                  </p>
                </div>
              </div>
            ))}
          </div>

          <p className="mt-8 text-sm text-white/70 italic">
            {t.fleet.disclaimer}
          </p>
          <p
  className="mt-2 text-sm text-neutral-400"
  dangerouslySetInnerHTML={{ __html: t.fleet.guarantee }}
/>

          <div className="mt-10 flex justify-center">
            <a href="/book">
              <Button className={`px-8 min-h-11 sm:min-h-12 py-2.5 ${btnPrimary}`}>
                {t.fleet.cta}
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </a>
          </div>
        </div>
      </section>

      {/* ── SAFETY ── */}
      <section className="py-12 sm:py-24 bg-neutral-950">
        <div className="mx-auto max-w-7xl px-5 sm:px-8 lg:px-16">
          <p className="text-xs font-bold uppercase tracking-widest text-primary mb-3">
            {t.safety.label}
          </p>
          <h2 className="font-serif font-bold text-3xl sm:text-4xl lg:text-5xl leading-tight mb-6">
            {t.safety.title}
          </h2>

          {/* Chauffeur image + intro */}
          <div className="grid gap-8 lg:grid-cols-2 lg:items-center mb-16">
            <div>
              <p className="text-sm sm:text-base text-neutral-400 leading-relaxed mb-6">
                {t.safety.intro}
              </p>
              <a href="/book">
                <Button className={`px-6 sm:px-8 h-auto min-h-11 sm:min-h-12 py-2.5 max-w-full whitespace-normal text-center leading-snug ${btnPrimary}`}>
                  {t.safety.cta}
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </a>
            </div>
            <div className="relative w-full aspect-video sm:aspect-[4/3] rounded-2xl overflow-hidden">
              <Image
                src="/images/FleetChauffeur.png"
                alt={t.safety.imageAlt}
                fill
                className="object-cover object-top"
                sizes="(max-width: 640px) 100vw, 50vw"
              />
              <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/60 to-transparent p-4">
                <p className="text-xs text-white/70 italic">
                  {t.safety.imageCaption}
                </p>
              </div>
            </div>
          </div>

          {/* Safety pillars */}
          <div className="grid gap-6 sm:grid-cols-2">
            {t.safety.pillars.map((p: any, i: number) => (
              <div
                key={i}
                className="flex flex-col border border-white/10 rounded-2xl bg-black/40 p-6 sm:p-8 hover:border-primary/50 transition-all duration-300"
              >
                <div className="h-px w-10 bg-primary mb-4" />
                <h3 className="font-serif font-bold text-lg sm:text-xl mb-3">
                  {p.title}
                </h3>
                <p
  className="text-sm text-neutral-400 leading-relaxed whitespace-pre-line [&_a]:text-primary [&_a]:font-bold [&_a:hover]:underline"
  {...(p.description.includes("<a")
    ? { dangerouslySetInnerHTML: { __html: p.description } }
    : { children: p.description })}
/>
                {p.checks && (
                  <ul className="mt-3 space-y-1">
                    {p.checks.map((c: string, j: number) => (
                      <li
                        key={j}
                        className="text-sm text-neutral-300 flex gap-2"
                      >
                        <span className="text-primary">✓</span> {c}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── TESTIMONIALS ── */}
      <section className="pt-16 sm:pt-24">
        <div className="mx-auto max-w-7xl px-5 sm:px-8 lg:px-16 mb-10 text-center">
          <h2 className="font-serif font-bold text-3xl sm:text-4xl lg:text-5xl leading-tight">
            {" What Our Clients Say About Our Fleet"}
          </h2>
        </div>
        <Testimonials data={testimonials} />
      </section>

      {/* ── FAQ ── */}
      <section className="py-12 sm:py-24 bg-black">
        <div className="mx-auto max-w-7xl px-5 sm:px-8 lg:px-16">
          <h2 className="font-serif font-bold text-3xl sm:text-4xl lg:text-5xl leading-tight text-center mb-12">
            {"Fleet & Vehicle FAQs"}
          </h2>
          <FA data={fa} />
          <div className="mt-12 flex justify-center">
            <a href={`/faq`}>
              <Button
                variant="outline"
                className="rounded-full px-6 sm:px-8 uppercase tracking-widest text-xs font-semibold h-auto min-h-11 sm:min-h-12 py-2.5 max-w-full whitespace-normal text-center leading-snug border-white text-white hover:bg-white hover:text-black"
              >
                <Phone className="mr-2 h-4 w-4" />
                {"Have More Questions? Contact Us"}
              </Button>
            </a>
          </div>
        </div>
      </section>
    </main>
  );
}
