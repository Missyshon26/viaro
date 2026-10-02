"use client";

import { SafeImage } from "@/components/ui/SafeImage";
import { FA } from "../FA";
import { FAMap } from "@/data/Fa";
import { TestimonialsMap } from "@/data/Tetimonials";
import { Testimonials } from "../testimonials";
import { locationEn } from "@/data/locations";
import { useParams } from "next/navigation";
import React, { useEffect, useState } from "react";
import { getDictionary } from "@/lib/get-dictionary";
import { ArrowRight, Phone } from "lucide-react";
import { Button } from "../ui/button";

const btnPrimary =
  "bg-primary text-white hover:bg-brand2 rounded-full uppercase tracking-widest text-xs font-semibold transition-colors";

// ─────────────────────────────────────────────────────────────────────────────
// TRUST ICON — mismo del ServicePage
// ─────────────────────────────────────────────────────────────────────────────
function getTrustIcon(label: string) {
  const l = label.toLowerCase();

  if (
    l.includes("flight") || l.includes("vuelo") || l.includes("track") ||
    l.includes("rastreo") || l.includes("aeropuerto") || l.includes("airport")
  )
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}
        strokeLinecap="round" strokeLinejoin="round" width={28} height={28}>
        <path d="M4 16L8.5 8 11 13l3-2.5L18 8l-2 8-6-3z" />
        <circle cx="19" cy="5" r="1.5" fill="currentColor" stroke="none" />
        <circle cx="19" cy="5" r="3.5" strokeWidth={1} opacity={0.5} />
        <circle cx="19" cy="5" r="5.5" strokeWidth={0.7} opacity={0.25} />
      </svg>
    );

  if (
    l.includes("save") || l.includes("ahorra") || l.includes("%") ||
    l.includes("early") || l.includes("anticip") || l.includes("viaje") ||
    l.includes("trip") || l.includes("60") || l.includes("000")
  )
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}
        strokeLinecap="round" strokeLinejoin="round" width={28} height={28}>
        <circle cx="12" cy="12" r="10" />
        <path d="M12 6v6l4 2" />
      </svg>
    );

  if (
    l.includes("tarifa") || l.includes("fija") || l.includes("flat") ||
    l.includes("rate") || l.includes("precio") || l.includes("price") ||
    l.includes("lock") || l.includes("recargo") || l.includes("surge")
  )
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}
        strokeLinecap="round" strokeLinejoin="round" width={28} height={28}>
        <path d="M5 2h12a1 1 0 0 1 1 1v17l-2-1.5-2 1.5-2-1.5-2 1.5-2-1.5-2 1.5V3a1 1 0 0 1 1-1z" />
        <line x1="8" y1="7" x2="14" y2="7" />
        <line x1="8" y1="11" x2="14" y2="11" />
        <line x1="8" y1="15" x2="11" y2="15" />
      </svg>
    );

  if (
    l.includes("24") || l.includes("soporte") || l.includes("support") ||
    l.includes("booking") || l.includes("reserva")
  )
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}
        strokeLinecap="round" strokeLinejoin="round" width={28} height={28}>
        <rect x="3" y="4" width="18" height="17" rx="2" />
        <line x1="3" y1="9" x2="21" y2="9" />
        <line x1="8" y1="2" x2="8" y2="6" />
        <line x1="16" y1="2" x2="16" y2="6" />
        <circle cx="15" cy="15" r="4" />
        <polyline points="15 13 15 15.5 16.5 16.5" />
      </svg>
    );

  if (l.includes("chauffeur") || l.includes("chofer") || l.includes("vetted") ||
    l.includes("verificado") || l.includes("pro") || l.includes("driver"))
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}
        strokeLinecap="round" strokeLinejoin="round" width={28} height={28}>
        <circle cx="12" cy="8" r="4" />
        <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
      </svg>
    );

  if (l.includes("luxury") || l.includes("lujo") || l.includes("fleet") || l.includes("flota"))
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}
        strokeLinecap="round" strokeLinejoin="round" width={28} height={28}>
        <path d="M5 17H3a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2v3" />
        <rect x="9" y="11" width="14" height="10" rx="2" />
        <circle cx="12" cy="21" r="1" />
        <circle cx="20" cy="21" r="1" />
      </svg>
    );

  if (l.includes("on-time") || l.includes("puntual") || l.includes("99"))
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}
        strokeLinecap="round" strokeLinejoin="round" width={28} height={28}>
        <circle cx="12" cy="12" r="10" />
        <path d="M12 6v6l4 2" />
      </svg>
    );

  if (l.includes("airport") || l.includes("aeropuerto") || l.includes("airports"))
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}
        strokeLinecap="round" strokeLinejoin="round" width={28} height={28}>
        <path d="M22 16.5H2M2 16.5l4-8 4 4 4-2 4-4 2 2-4 8z" />
        <path d="M6 19.5h12" />
      </svg>
    );

  // fallback
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}
      strokeLinecap="round" strokeLinejoin="round" width={28} height={28}>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENTE PRINCIPAL
// ─────────────────────────────────────────────────────────────────────────────
export default function LocationPage() {
  const params = useParams<{ id: string }>();
    const id = params.id;

  const [dict, setDict] = useState<any>(null);

  useEffect(() => {
    getDictionary().then(setDict);
  }, []);

  const dataset = locationEn;
  const data = dataset.find((loc) => loc.id === id);

  if (!data) return <p className="text-white p-10">Location not found: {id}</p>;
  if (!dict) return null;

  const faSource = FAMap;
  const testiSource = TestimonialsMap;
  const faData = faSource[data.FA as keyof typeof faSource] || [];
  const testiData = testiSource[data.Testi as keyof typeof testiSource] || [];

  return (
    <main className="bg-black text-white">

    
      <section
        className="relative flex min-h-[100dvh] items-end"
      >
        <SafeImage
          src={data.hero.image.src}
          alt={data.hero.image.alt}
          fill
          priority
          className="object-cover object-center"
          sizes="100vw"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black via-black/70 to-black/50" />
        <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-primary/50 to-transparent" />

        <div className="relative z-10 w-full max-w-7xl mx-auto px-5 sm:px-8 lg:px-16 pt-28 pb-24 sm:pb-20">
         

          <h1 className="font-serif font-bold leading-tight text-3xl sm:text-4xl lg:text-5xl xl:text-6xl max-w-3xl">
            {data.hero.h1}
          </h1>
          <h2 className="mt-3 max-w-xl text-[0.95rem] leading-relaxed text-white/85 sm:text-lg [text-shadow:0_1px_3px_rgba(0,0,0,0.85)]">
            {data.hero.h2}
          </h2>

          <div className="mt-5 flex flex-wrap gap-3">
            <a href="/book">
              <Button className={`px-6 sm:px-8 h-auto min-h-11 sm:min-h-12 py-2.5 max-w-full whitespace-normal text-center leading-snug ${btnPrimary}`}>
                {data.hero.cta.book}
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </a>
            <a href={`tel:${data.hero.cta.phone.replace(/\D/g, "")}`}>
              <Button
                variant="outline"
                className="rounded-full px-6 sm:px-8 uppercase tracking-widest text-xs font-semibold h-auto min-h-11 sm:min-h-12 py-2.5 max-w-full whitespace-normal text-center leading-snug border-white text-white hover:bg-white hover:text-black"
              >
                <Phone className="mr-2 h-4 w-4" />
                {data.hero.cta.phone}
              </Button>
            </a>
          </div>

          {data.hero.description && (
            <p className="mt-5 max-w-2xl text-[0.95rem] leading-relaxed text-white/85 sm:text-lg [text-shadow:0_1px_3px_rgba(0,0,0,0.85)]">
              "{data.hero.description}"
            </p>
          )}

          {data.hero.image.caption && (
            <p className="mt-2 text-xs text-white/60">
              {data.hero.image.caption}
            </p>
          )}
        </div>
      </section>
      {data.trustBar && data.trustBar.length > 0 && (
        <section
          style={{
            background: "rgb(30,30,30)",
            borderTop: "1px solid rgba(255,255,255,0.1)",
            borderBottom: "1px solid rgba(255,255,255,0.1)",
            padding: "32px 12px",
            overflow: "hidden",
          }}
        >
          <style>{`
            .trust-bar-grid {
              display: grid;
              grid-template-columns: repeat(${data.trustBar.length}, 1fr);
              gap: 8px 4px;
              text-align: center;
              max-width: 900px;
              margin: 0 auto;
            }
            .trust-bar-icon svg { width: 26px; height: 26px; }
            .trust-bar-label { font-size: clamp(11px, 1.8vw, 13px); line-height: 1.25 !important; }
            @media (max-width: 540px) {
              .trust-bar-grid { gap: 10px 4px; }
              .trust-bar-icon svg { width: 18px; height: 18px; }
              .trust-bar-label { font-size: 11px; }
              .trust-bar-value { font-size: 11px !important; }
            }
          `}</style>

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
            {data.trustBarTitle}
          </p>

          <div className="trust-bar-grid">
            {data.trustBar.map((item, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 8,
                  padding: "8px 4px",
                }}
              >
                <div
                  className="trust-bar-icon"
                  style={{ color: "#89b4d4" }}
                >
                  {getTrustIcon(item)}
                </div>
                <span
                  className="trust-bar-label"
                  style={{
                    fontSize: "clamp(10px, 3.5vw, 20px)",
                    fontWeight: 700,
                    color: "#fff",
                    lineHeight: 1,
                  }}
                >
                  {item}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="bg-black">
        <div className="mx-auto max-w-7xl px-5 sm:px-8 lg:px-16 pt-16 sm:pt-20 pb-4">

          <h2 className="font-serif font-bold text-3xl sm:text-4xl lg:text-5xl leading-tight mb-2">
            {data.bodyContent.h2}
          </h2>
          <h3 className="text-sm font-bold uppercase tracking-widest text-primary mb-8">
            {data.bodyContent.h3}
          </h3>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 items-start mb-16">
            <div className="max-w-3xl space-y-5 text-left md:text-justify">
              {data.bodyContent.content.map((p, i) => (
                <p key={i} className="text-sm sm:text-base text-neutral-400 leading-relaxed">
                  {p}
                </p>
              ))}
            </div>

            {data.bodyContent.image && (
              <div>
                <div className="relative w-full aspect-[16/10] rounded-2xl overflow-hidden border border-white/5">
                  <SafeImage
                    src={data.bodyContent.image.src}
                    alt={data.bodyContent.image.alt}
                    fill
                    className="object-cover"
                    sizes="(max-width:1024px) 100vw, 50vw"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent" />
                </div>
                {data.bodyContent.image.caption && (
                  <p className="mt-2 text-xs text-neutral-400 italic text-center">
                    {data.bodyContent.image.caption}
                  </p>
                )}
              </div>
            )}
          </div>          
        </div>
      </section>

      {data.extraContent && data.extraContent.length > 0 && (
        <section className="py-10 sm:py-24 bg-black">
          <div className="mx-auto max-w-7xl px-5 sm:px-8 lg:px-16 space-y-24">
            {data.extraContent.map((section, i) => (
              <div key={i}>

                <div className="flex items-center gap-4 mb-6">
                  <div className="h-px w-8 bg-primary flex-shrink-0" />
                  <h3 className="font-serif font-bold text-2xl sm:text-3xl text-primary">
                    {section.h3}
                  </h3>
                </div>

                {section.image ? (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 items-start mb-8">
                    <div className="max-w-3xl space-y-5">
                      {section.content?.map((p, j) => (
                        <p key={j} className="text-sm sm:text-base text-neutral-400 leading-relaxed">
                          {p}
                        </p>
                      ))}
                    </div>
                    <div>
                      <div className="relative w-full aspect-[16/9] rounded-2xl overflow-hidden border border-white/5">
                        <SafeImage
                          src={section.image.src}
                          alt={section.image.alt}
                          fill
                          className="object-cover object-[50%_80%]"
                          sizes="(max-width: 1024px) 100vw, 50vw"
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent" />
                      </div>
                      {section.image.caption && (
                        <p className="mt-2 text-xs text-neutral-400 italic text-center">
                          {section.image.caption}
                        </p>
                      )}
                    </div>
                  </div>
                ) : (
                  section.content && (
                    <div className="max-w-3xl space-y-5 mb-8">
                      {section.content.map((p, j) => (
                        <p key={j} className="text-sm sm:text-base text-neutral-400 leading-relaxed">
                          {p}
                        </p>
                      ))}
                    </div>
                  )
                )}

                {/* Quote */}
                {section.quote && (
                  <blockquote className="relative pl-8 border-l-2 border-primary mb-8">
                    <div className="absolute -left-3 top-0 h-6 w-6 rounded-full bg-primary/20 border border-primary/40 flex items-center justify-center">
                      <span className="text-primary text-xs font-bold">"</span>
                    </div>
                    <div className="text-sm sm:text-base text-neutral-300 leading-relaxed italic">
                      {section.quote}
                    </div>
                  </blockquote>
                )}

                {section.items && (
                  <div className="grid gap-6 sm:grid-cols-3 mb-10">
                    {section.items.map((item) => (
                      <div
                        key={item.label}
                        className="group flex gap-4 border border-white/5 rounded-2xl p-5 bg-neutral-900/30 hover:border-primary/30 hover:bg-neutral-900/60 transition-all duration-300"
                      >
                        <div className="flex-shrink-0 mt-1 h-7 w-7 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center group-hover:bg-primary/20 transition-colors">
                          <div className="w-3 h-3 bg-primary rounded-full shadow-[0_0_10px_rgba(59,130,246,0.8)]" />
                        </div>
                        <div>
                          <p className="text-sm sm:text-base font-semibold text-white mb-1 group-hover:text-primary transition-colors">
                            {item.label}
                          </p>
                          <p className="text-sm sm:text-base font-semibold text-white mb-1 group-hover:text-primary transition-colors">
                            {item.time}
                          </p>
                          <p className="text-sm text-neutral-400 leading-relaxed">{item.desc}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* List */}
                {section.list && (
                  <>
                    {(section as any).desc && (
                      <p className="text-sm text-neutral-300 mb-6 leading-relaxed">
                        {(section as any).desc}
                      </p>
                    )}
                    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 mb-10">
                      {section.list.map((item, idx) => (
                        <li key={idx} className="flex gap-3 items-start group">
                          <div className="flex-shrink-0 mt-0.5 h-5 w-5 rounded-full bg-primary/10 border border-primary/30 flex items-center justify-center group-hover:bg-primary/20 transition-colors">
                            <span className="text-primary text-[10px] font-bold">✓</span>
                          </div>
                          <span className="text-sm text-neutral-300 leading-relaxed group-hover:text-white transition-colors">
                            {item}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}

                {/* Port list */}
                {section.portList && (
                  <div className="mb-10">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                      {section.portList.map((p) => (
                        <div
                          key={p.port}
                          className="p-6 rounded-2xl bg-neutral-900/50 border border-white/5 hover:border-primary/50 transition-all group"
                        >
                          <div className="flex justify-between items-start mb-4">
                            <h3 className="text-lg font-semibold text-white group-hover:text-primary transition-colors">
                              {p.port}
                            </h3>
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
                              strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"
                              width={20} height={20}
                              className="shrink-0 text-brand group-hover:text-primary transition-colors duration-200"
                            >
                              <circle cx="12" cy="5" r="3" />
                              <path d="M12 8v13M5 11a7 7 0 0 0 14 0" />
                            </svg>
                          </div>
                          <p className="text-neutral-400 text-sm leading-relaxed">{p.terminals}</p>
                          <span className="inline-block mt-4 text-xs font-semibold uppercase tracking-widest text-primary bg-primary/10 border border-primary/20 rounded-full px-2 py-0.5">
                            {p.note}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* CTA */}
                {section.cta && (
                  <div className="text-center">
                    <a href="/book">
                      <Button className={`px-8 min-h-11 sm:min-h-12 py-2.5 ${btnPrimary}`}>
                        {section.cta}
                        <ArrowRight className="ml-2 h-4 w-4" />
                      </Button>
                    </a>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
{data.whereSection && (
  <section
    className="py-12 sm:py-24"
    style={{
      background: "rgb(10,10,10)",
      borderTop: "1px solid rgba(255,255,255,0.06)",
    }}
  >
    <div className="mx-auto max-w-7xl px-5 sm:px-8 lg:px-16">

      {/* Header centrado */}
      <div className="flex flex-col items-center text-center mb-10">
        <div className="h-px w-8 bg-primary mb-6" />
        <h2 className="font-serif font-bold text-3xl sm:text-4xl lg:text-5xl leading-tight">
          {data.whereSection.h2.split("Viaro")
            .map((part: string, i: number, arr: string[]) => (
              <React.Fragment key={i}>
                {part}
                {i < arr.length - 1 && (
                  <span className="text-muted2">Viaro</span>
                )}
              </React.Fragment>
            ))
          }
        </h2>
        <h3  className="font-serif font-bold text-xs sm:text-xl lg:text-3xl leading-tight">
           {data.whereSection.h3}
        </h3>
      </div>
      {data.whereSection.items && (
            <div className="grid grid-cols-2 gap-2 mt-6 mb-6">
              {data.whereSection.items.map((item, i) => (
                <div
                  key={i}
                  className="flex items-center gap-3 bg-white/[0.02] border border-white/5 rounded-xl px-4 py-3.5"
                >
                  <div className="flex-shrink-0 w-9 h-9 rounded-full bg-white/5 flex items-center justify-center">
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 16 16"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      className="text-neutral-400"
                    >
                      <circle cx="8" cy="8" r="6" />
                      <path d="M8 5v3l2 2" />
                    </svg>
                  </div>
                  <div>
                    <div className="text-sm font-medium text-white">{item.label}</div>
                    <div className="text-xs text-neutral-500 mt-0.5">
                      {item.time} · {item.desc}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-start">
        {/* Content */}
        <div className="space-y-4">
          {data.whereSection.content.map((p, i) => (
            <p key={i} className="text-sm sm:text-base text-neutral-400 leading-relaxed">
              {p}
            </p>
          ))}

          

         
        </div>

        {/* Image */}
        <div>
          <div className="relative w-full aspect-[16/10] rounded-2xl overflow-hidden border border-white/5">
            <SafeImage
              src={data.whereSection.image.src}
              alt={data.whereSection.image.alt}
              fill
              className="object-cover object-[50%_60%]"
              sizes="(max-width:1024px) 100vw, 50vw"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent" />
          </div>
          {data.whereSection.image.caption && (
            <p className="mt-3 text-xs text-neutral-400 italic text-center">
              {data.whereSection.image.caption}
            </p>
          )}
        </div>
      </div>
       <div className="pt-6 flex justify-center">
            <a href="/book">
              <Button className={`px-8 min-h-11 sm:min-h-12 py-2.5 ${btnPrimary}`}>
                {data.whereSection.cta}
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </a>
          </div>
    </div>
  </section>
)}

      {/* ══════════════════════════════════════════════════════════════
          PRICING
      ══════════════════════════════════════════════════════════════ */}
      <section className="py-12 sm:py-24 bg-neutral-950">
        <div className="mx-auto max-w-7xl px-5 sm:px-8 lg:px-16">
          <h2 className="font-serif font-bold text-3xl sm:text-4xl lg:text-5xl leading-tight text-center mb-12">
            {data.pricing.h2}
          </h2>

          <div className="grid gap-6 sm:grid-cols-3">
            {data.pricing.vehicles.map((v) => (
              <div
                key={v.type}
                className={`relative flex flex-col border rounded-2xl bg-neutral-900/40 p-6 sm:p-8 hover:border-primary transition-all duration-300 ${
                  v.badge ? "border-primary/40" : "border-white/10"
                }`}
              >
                {v.badge && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 text-[11px] font-bold px-4 py-1 rounded-full uppercase tracking-widest whitespace-nowrap bg-primary text-white">
                    {v.badge}
                  </span>
                )}

                <h3 className="font-serif font-bold text-xl sm:text-2xl mb-2">{v.type}</h3>

                {v.price > 0 && (
                  <>
                    <p className="text-xs font-semibold uppercase tracking-widest text-neutral-500 mb-0.5">
                      {"Starting at"}
                    </p>
                    <p className="text-4xl font-bold text-primary mb-1">${v.price}</p>
                  </>
                )}

                {v.passengers > 0 && (
                  <p className="text-xs text-neutral-500 mb-6">
                    {v.passengers} {"passengers"} · {v.bags}{" "}
                    {"bags"}
                  </p>
                )}

                <div className="flex-grow">
                  <p className="text-xs uppercase tracking-widest text-neutral-400 mb-2">
                    {"Included"}
                  </p>
                  <ul className="space-y-1">
                    {v.extras.map((e) => (
                      <li key={e} className="flex items-start gap-2 text-sm text-neutral-400">
                        <span className="text-primary flex-shrink-0">✓</span>
                        {e}
                      </li>
                    ))}
                  </ul>
                </div>

                <a href="/book" className="mt-8 block">
                  <Button
                    className={`w-full h-auto min-h-11 py-2 ${btnPrimary} whitespace-normal text-center leading-snug`}
                  >
                    {`Book ${v.type}`} →
                  </Button>
                </a>
              </div>
            ))}
          </div>

          <p className="text-neutral-500 text-sm text-center mt-8 mb-10 max-w-2xl mx-auto leading-relaxed">
            {data.pricing.note}
          </p>

          <div className="text-center">
            <a href="/book">
              <Button className={`px-8 min-h-11 sm:min-h-12 py-2.5 ${btnPrimary}`}>
                {data.pricing.cta}
              </Button>
            </a>
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════
          TESTIMONIALS
      ══════════════════════════════════════════════════════════════ */}
      <section className="pt-16 sm:pt-24">
        <div className="mx-auto max-w-7xl px-5 sm:px-8 lg:px-16 mb-10 text-center">
          <h2 className="font-serif font-bold text-3xl sm:text-4xl lg:text-5xl leading-tight">
            {"WHAT OUR TRAVELERS SAY"}
          </h2>
        </div>
        <Testimonials data={testiData} />
      </section>

      {/* ══════════════════════════════════════════════════════════════
          FAQ
      ══════════════════════════════════════════════════════════════ */}
      <section className="py-12 sm:py-24 bg-black">
        <div className="mx-auto max-w-7xl px-5 sm:px-8 lg:px-16">
          <h2 className="font-serif font-bold text-3xl sm:text-4xl lg:text-5xl leading-tight text-center mb-12">
            {"Frequently Asked Questions"}
          </h2>
          <FA data={faData} />
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