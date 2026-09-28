"use client";

import Image from "next/image";
import { AboutTestimonials } from "@/data/Tetimonials";
import { Testimonials } from "../testimonials";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { getDictionary } from "@/lib/get-dictionary";
import { AboutFa } from "@/data/Fa";
import { FA } from "../FA";
import { ArrowRight, Phone } from "lucide-react";
import { Button } from "../ui/button";

const btnPrimary =
  "bg-primary text-white hover:bg-brand2 rounded-full uppercase tracking-widest text-xs font-semibold transition-colors";

const METRICS = [
  {
    value: "60,000+",
    label: { en: "Trips Completed", es: "Viajes Completados" },
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" width={28} height={28}>
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
    value: "25 Years",
    label: { en: "In Logistics", es: "En Logística" },
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" width={28} height={28}>
        <path d="M5 17H3a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2v3" />
        <rect x="9" y="11" width="14" height="10" rx="2" />
        <circle cx="12" cy="21" r="1" />
        <circle cx="20" cy="21" r="1" />
      </svg>
    ),
  },
  {
    value: "5-Star",
    label: { en: "Rating", es: "Calificación" },
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" width={28} height={28}>
        <path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z" />
      </svg>
    ),
  },
];

export default function AboutContent() {
  const params = useParams();
    const [dict, setDict] = useState<any>(null);
  const fa = AboutFa;

  useEffect(() => {
    getDictionary().then(setDict);
  }, []);

  const testimonios = AboutTestimonials;
  if (!dict) return null;
  const t = dict.about;

  return (
    <main className="bg-black text-white">

      {/* ── HERO ── */}
      <section className="relative w-full overflow-hidden" style={{ height: "100dvh" }}>
        <Image
          src="/images/ImagenAboutUs.png"
          alt="Viaro luxury black car"
          fill
          priority
          className="object-cover object-top sm:object-center"
          sizes="100vw"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black via-black/70 to-black/20" />

        {/* Todo abajo siempre — se eliminó justify-between y el eyebrow flotante de móvil */}
        <div className="absolute inset-0 z-10 flex flex-col justify-end mx-auto w-full max-w-7xl px-5 sm:px-8 lg:px-16 pb-10 sm:pb-20">
          <div>
            <p className="mb-3 text-[10px] sm:text-xs font-semibold uppercase tracking-[0.08em] text-brand whitespace-pre-line">
              {t.hero.eyebrow}
            </p>

            <h1 className="font-serif font-bold leading-[1.1] text-[1.6rem] xs:text-3xl sm:text-4xl lg:text-5xl xl:text-6xl max-w-[280px] xs:max-w-sm sm:max-w-xl lg:max-w-2xl">
              {t.hero.title}
            </h1>

            {t.hero.subtitle && (
              <p className="mt-2 sm:mt-3 text-xs sm:text-base text-white/60 leading-relaxed font-light max-w-[260px] xs:max-w-xs sm:max-w-xl">
                {t.hero.subtitle}
              </p>
            )}

            <div className="mt-5 sm:mt-8 flex flex-wrap gap-3">
              <a href="/book">
                <Button className={`px-6 sm:px-8 h-11 sm:h-12 ${btnPrimary}`}>
                  {t.hero.cta_book}
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </a>
              <a href="tel:2066728281">
                <Button
                  variant="outline"
                  className="rounded-full px-6 sm:px-8 uppercase tracking-widest text-xs font-semibold h-11 sm:h-12 border-white text-white hover:bg-white hover:text-black"
                >
                  <Phone className="mr-2 h-4 w-4" />
                  {t.hero.cta_call}
                </Button>
              </a>
            </div>

            {t.hero.quote && (
              <p className="mt-4 text-sm italic text-white/30 sm:text-base">
                "{t.hero.quote}"
              </p>
            )}
          </div>
        </div>
      </section>

      <section
        style={{
          background: "rgb(30,30,30)",
          borderTop: "1px solid rgba(255,255,255,0.1)",
          borderBottom: "1px solid rgba(255,255,255,0.1)",
          padding: "32px 12px",
          overflow: "hidden",
        }}
      >
        <p
          style={{
            textAlign: "center",
            fontSize: 11,
            textTransform: "uppercase",
            letterSpacing: "0.15em",
            color: "rgba(255,255,255,0.4)",
            marginBottom: 24,
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
            gridTemplateColumns: "repeat(4, 1fr)",
            gap: "8px 4px",
            textAlign: "center",
          }}
        >
          {METRICS.map((m) => (
            <div
              key={m.value}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "flex-start",
                gap: 8,
                padding: "12px 8px",
              }}
            >
              {/* Icono con tamaño fijo, sin solaparse */}
              <div
                style={{
                  color: "#89b4d4",
                  width: 28,
                  height: 28,
                  flexShrink: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {m.icon}
              </div>

              <span
                style={{
                  fontSize: "clamp(14px, 3.5vw, 22px)",
                  fontWeight: 700,
                  color: "#fff",
                  lineHeight: 1,
                }}
              >
                {m.value}
              </span>

              <span
                style={{
                  fontSize: "clamp(8px, 1.8vw, 11px)",
                  color: "rgba(255,255,255,0.4)",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  lineHeight: 1.3,
                }}
              >
                {m.label.en}
              </span>
            </div>
          ))}
        </div>

        {/* Media query para móvil: 2 columnas × 2 filas */}
        <style>{`
    @media (max-width: 540px) {
      #trust-grid {
        grid-template-columns: repeat(2, 1fr) !important;
        gap: 16px 8px !important;
      }
    }
  `}</style>
      </section>

      {/* ── STORY ── */}
      <section className="py-12 sm:py-24 bg-black">
        <div className="mx-auto max-w-7xl px-5 sm:px-8 lg:px-16">
          <p className="text-xs font-bold uppercase tracking-widest text-primary mb-3">
            {t.story.label}
          </p>
          <h2 className="font-serif font-bold text-3xl sm:text-4xl lg:text-5xl leading-tight mb-6">
            {t.story.title}
          </h2>
          <div className="grid gap-8 lg:grid-cols-2 lg:items-stretch">
            <div className="flex flex-col justify-between gap-6">
              <div className="space-y-4">
                {(t.story.paragraphs as string[]).map((p: string, i: number) => (
                  <p key={i} className="text-sm sm:text-base text-neutral-300 leading-relaxed">{p}</p>
                ))}
                <a href="/service-areas" className="inline-block mt-2 text-sm text-primary underline underline-offset-4 hover:opacity-80 transition-opacity">
                  {t.story.cta}
                </a>
              </div>
              <Button className={`self-start sm:self-center px-6 sm:px-8 h-11 sm:h-12 ${btnPrimary}`}>
                {t.story.city}
              </Button>
            </div>
            <div className="relative w-full aspect-video sm:aspect-[4/3] lg:aspect-auto lg:min-h-[400px] rounded-2xl overflow-hidden">
              <Image
                src="/images/Imagen2About.png"
                alt="Viaro fleet across North America"
                fill
                className="object-cover"
                sizes="(max-width: 640px) 100vw, (max-width: 1024px) 100vw, 50vw"
              />
            </div>
          </div>
        </div>
      </section>

      {/* ── TEAM ── */}
      <section className="relative py-12 sm:py-24 overflow-hidden">
        <div className="absolute inset-0">
          <Image
            src="/images/ImagenTAbout.png"
            alt={t.team.title}
            fill
            className="object-cover object-center"
            sizes="100vw"
          />
          <div className="absolute inset-0 bg-neutral-950/80" />
        </div>
        <div className="relative z-10 mx-auto max-w-7xl px-5 sm:px-8 lg:px-16">
          <p className="text-xs font-bold uppercase tracking-widest text-primary mb-3">{t.team.label}</p>
          <h2 className="font-serif font-bold text-3xl sm:text-4xl lg:text-5xl leading-tight max-w-2xl mb-12">{t.team.title}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {t.team.members.map((item: any, i: number) => (
              <div key={i} className="flex flex-col gap-4 border border-white/10 rounded-2xl bg-black/40 backdrop-blur-sm p-6 sm:p-8 hover:border-primary/50 hover:bg-black/60 transition-all duration-300">
                <div className="h-px w-10 bg-primary" />
                <h3 className="font-serif font-bold text-lg sm:text-xl text-white">{item.title}</h3>
                <p className="text-sm text-neutral-300 leading-relaxed whitespace-pre-wrap">{item.description}</p>
              </div>
            ))}
          </div>
          {t.team.cta && (
            <div className="mt-10 flex justify-center">
              <a href="/favorites">
                <Button className={`px-6 sm:px-8 h-11 sm:h-12 ${btnPrimary}`}>
                  {t.team.cta}
                </Button>
              </a>
            </div>
          )}
        </div>
      </section>

      {/* ── VALUES ── */}
      <section className="py-12 sm:py-24 bg-black">
        <div className="mx-auto max-w-7xl px-5 sm:px-8 lg:px-16">
          <p className="text-xs font-bold uppercase tracking-widest text-primary mb-3">{t.values.label}</p>
          <h2 className="font-serif font-bold text-3xl sm:text-4xl lg:text-5xl leading-tight mb-12">{t.values.title}</h2>
          <div className="grid gap-6 sm:grid-cols-2">
            {t.values.items.map((value: any, i: number) => (
              <div key={i} className="flex flex-col border border-white/10 rounded-2xl bg-neutral-900/40 p-6 sm:p-8 hover:border-primary transition-all duration-300">
                <div className="mb-4 h-px w-10 bg-primary" />
                <h3 className="font-serif font-bold text-xl sm:text-2xl mb-3">{value.title}</h3>
                <p className="text-sm sm:text-base text-neutral-400 leading-relaxed">{value.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── MISSION ── */}
      <section className="py-12 sm:py-24 bg-neutral-950">
        <div className="mx-auto max-w-7xl px-5 sm:px-8 lg:px-16">
          <div className="grid gap-8 lg:grid-cols-2 lg:items-center">
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-primary mb-3">{t.mission.label ?? "Mission"}</p>
              <h2 className="font-serif font-bold text-3xl sm:text-4xl lg:text-5xl leading-tight mb-6">{t.mission.title}</h2>
              <p className="text-sm sm:text-base text-neutral-400 leading-relaxed whitespace-pre-line">{t.mission.description}</p>
            </div>
            <div className="relative w-full aspect-video sm:aspect-[4/3] rounded-2xl overflow-hidden">
              <Image
                src="/images/ImagenAboutMain.png"
                alt="Luxury executive transportation"
                fill
                className="object-cover"
                sizes="(max-width: 640px) 100vw, (max-width: 1024px) 100vw, 50vw"
              />
            </div>
          </div>
        </div>
      </section>

      {/* ── VISION ── */}
      <section className="py-12 sm:py-24 bg-black">
        <div className="mx-auto max-w-7xl px-5 sm:px-8 lg:px-16">
          <div className="grid gap-8 lg:grid-cols-2 lg:items-center">
            <div className="relative w-full aspect-video sm:aspect-[4/3] rounded-2xl overflow-hidden order-1 lg:order-1">
              <Image
                src="/images/Imagen3About.png"
                alt="Future of luxury transportation"
                fill
                className="object-cover"
                sizes="(max-width: 640px) 100vw, (max-width: 1024px) 100vw, 50vw"
              />
            </div>
            <div className="order-2 lg:order-2">
              <p className="text-xs font-bold uppercase tracking-widest text-primary mb-3">{t.vision.label ?? "Vision"}</p>
              <h2 className="font-serif font-bold text-3xl sm:text-4xl lg:text-5xl leading-tight mb-6">{t.vision.title}</h2>
              <p className="text-sm sm:text-base text-neutral-400 leading-relaxed whitespace-pre-line">{t.vision.description}</p>
            </div>
          </div>
        </div>
      </section>

      {/* ── TESTIMONIALS ── */}
      <section className="pt-16 sm:pt-24">
        <div className="mx-auto max-w-7xl px-5 sm:px-8 lg:px-16 mb-2 text-center">
          <h2 className="font-serif font-bold text-3xl sm:text-4xl lg:text-5xl leading-tight">
            {"What Our Clients Say About Us"}
          </h2>
        </div>
        <Testimonials data={testimonios} />
      </section>

      {/* ── FAQ ── */}
      <section className="py-12 sm:py-24 bg-black">
        <div className="mx-auto max-w-7xl px-5 sm:px-8 lg:px-16">
          <h2 className="font-serif font-bold text-3xl sm:text-4xl lg:text-5xl leading-tight text-center mb-2">
            {"Frequently Asked Questions ABOUT VIARO"}
          </h2>
          <FA data={fa} />
          <div className="mt-3 flex justify-center">
            <a href={`/faq`}>
              <Button
                variant="outline"
                className="rounded-full px-6 sm:px-8 uppercase tracking-widest text-xs font-semibold h-11 sm:h-12 border-white text-white hover:bg-white hover:text-black"
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