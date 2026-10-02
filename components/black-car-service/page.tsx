"use client";

import Image from "next/image";
import { FA } from "../FA";
import { FAMap } from "@/data/Fa";
import { TestimonialsMap } from "@/data/Tetimonials";
import { Testimonials } from "../testimonials";
import { serviceEn } from "@/data/service";
import { useParams } from "next/navigation";
import React, { useEffect, useState } from "react";
import { getDictionary } from "@/lib/get-dictionary";
import { Button } from "@/components/ui/button";
import { ArrowRight, Phone } from "lucide-react";

const btnPrimary =
  "bg-primary text-white hover:bg-brand2 rounded-full uppercase tracking-widest text-xs font-semibold transition-colors";

function getTrustIcon(label: string) {
  const l = label.toLowerCase();

  if (
    l.includes("discre") ||
     l.includes("discret") ||
    l.includes("confidential") ||
    l.includes("privacy") ||
    l.includes("privaci") ||
    l.includes("vip")
  )
    return (
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
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10" />
        <circle cx="12" cy="11" r="2" />
        <line x1="12" y1="13" x2="12" y2="16" />
      </svg>
    );
  if (
    l.includes("guarant") ||
    l.includes("garantí") ||
    l.includes("garantia") ||
    l.includes("transparency") ||
    l.includes("transparenc")
  )
    return (
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
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <circle cx="11" cy="14" r="3" />
        <line x1="13.5" y1="16.5" x2="16" y2="19" />
      </svg>
    );
  if (l.includes("flexible") || l.includes("routing") || l.includes("ruta"))
    return (
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
        <circle cx="5" cy="6" r="2" />
        <circle cx="19" cy="6" r="2" />
        <circle cx="12" cy="19" r="2" />
        <path d="M5 8c0 4 3 6 7 6s7-2 7-6" />
        <line x1="12" y1="14" x2="12" y2="17" />
      </svg>
    );
  if (
    l.includes("wait") ||
    l.includes("espera") ||
    l.includes("return") ||
    l.includes("regreso")
  )
    return (
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
        <circle cx="12" cy="12" r="9" />
        <polyline points="12 7 12 12 15 14" />
        <path d="M3 3l3.5 3.5" />
        <path d="M3 7.5V3h4.5" />
      </svg>
    );
  if (
    l.includes("family") ||
    l.includes("familia") ||
    l.includes("safe family") ||
    (l.includes("safe") && l.includes("travel"))
  )
    return (
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
        <path d="M12 3L4 7v5c0 5 4 8 8 9 4-1 8-4 8-9V7z" />
        <circle cx="9" cy="10" r="1.5" />
        <circle cx="15" cy="10" r="1.5" />
        <circle cx="12" cy="12" r="1" />
        <path d="M6.5 15.5c.8-1.5 2-2.5 2.5-2.5h6c.5 0 1.7 1 2.5 2.5" />
      </svg>
    );
  if (
    l.includes("billing") ||
    l.includes("factura") ||
    l.includes("flat") ||
    l.includes("rate") ||
    l.includes("tarifa") ||
    l.includes("fija") ||
    l.includes("transparent")
  )
    return (
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
        <path d="M5 2h12a1 1 0 0 1 1 1v17l-2-1.5-2 1.5-2-1.5-2 1.5-2-1.5-2 1.5V3a1 1 0 0 1 1-1z" />
        <line x1="8" y1="7" x2="14" y2="7" />
        <line x1="8" y1="11" x2="14" y2="11" />
        <line x1="8" y1="15" x2="11" y2="15" />
      </svg>
    );

  if (
    l.includes("flight") ||
    l.includes("vuelo") ||
    l.includes("tail") ||
    l.includes("cola") ||
    l.includes("track") ||
    l.includes("rastreo")
  )
    return (
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
        <path d="M4 16L8.5 8 11 13l3-2.5L18 8l-2 8-6-3z" />
        <circle cx="19" cy="5" r="1.5" fill="currentColor" stroke="none" />
        <circle cx="19" cy="5" r="3.5" strokeWidth={1} opacity={0.5} />
        <circle cx="19" cy="5" r="5.5" strokeWidth={0.7} opacity={0.25} />
      </svg>
    );

  if (
    (l.includes("24") ||
      l.includes("support") ||
      l.includes("soporte") ||
      l.includes("booking") ||
      l.includes("reserva")) &&
    !l.includes("dispatch") &&
    !l.includes("despacho")
  )
    return (
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
        <rect x="3" y="4" width="18" height="17" rx="2" />
        <line x1="3" y1="9" x2="21" y2="9" />
        <line x1="8" y1="2" x2="8" y2="6" />
        <line x1="16" y1="2" x2="16" y2="6" />
        <circle cx="15" cy="15" r="4" />
        <polyline points="15 13 15 15.5 16.5 16.5" />
      </svg>
    );

  if (l.includes("dispatch") || l.includes("despacho"))
    return (
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
        <line x1="12" y1="12" x2="12" y2="21" />
        <path d="M7.5 7.5C6 9 5 11 5 13" />
        <path d="M16.5 7.5C18 9 19 11 19 13" />
        <path d="M9.5 9.5C8.5 10.5 8 12 8 13.5" />
        <path d="M14.5 9.5C15.5 10.5 16 12 16 13.5" />
        <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
      </svg>
    );

  if (
    l.includes("tarmac") ||
    l.includes("pista") ||
    l.includes("fbo") ||
    l.includes("pickup") ||
    l.includes("curbside")
  )
    return (
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
        <path d="M2 16l3-1 4 3 8-5 1-4-2 1-2 3-3-1 1-3-2 1-1 3-7 2z" />
        <line x1="2" y1="20" x2="22" y2="20" />
        <path d="M18 20v-5h3v5" />
        <circle cx="19.5" cy="16.5" r="0.5" fill="currentColor" stroke="none" />
      </svg>
    );

  if (
    l.includes("year") ||
    l.includes("año") ||
    l.includes("experience") ||
    l.includes("experiencia")
  )
    return (
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
        {/* Award medal with ribbon */}
        <circle cx="12" cy="8" r="6" />
        <path d="M8.21 13.89L7 23l5-3 5 3-1.21-9.12" />
        <line x1="10" y1="8" x2="12" y2="6" />
        <line x1="12" y1="6" x2="12" y2="11" />
      </svg>
    );

  if (
    l.includes("chauffeur") ||
    l.includes("chofer") ||
    l.includes("driver") ||
    l.includes("conductor") ||
    l.includes("pro")
  )
    return (
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
        <circle cx="12" cy="8" r="4" />
        <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
      </svg>
    );

  // ── FLEET / VEHICLE / LUXURY ─────────────────────────────────────────────────
  if (
    l.includes("fleet") ||
    l.includes("flota") ||
    l.includes("luxury") ||
    l.includes("lujo") ||
    l.includes("vehicle")
  )
    return (
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
        <path d="M5 17H3a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2v3" />
        <rect x="9" y="11" width="14" height="10" rx="2" />
        <circle cx="12" cy="21" r="1" />
        <circle cx="20" cy="21" r="1" />
      </svg>
    );

  if (
    l.includes("ship") ||
    l.includes("barco") ||
    l.includes("cruise") ||
    l.includes("crucero") ||
    l.includes("port") ||
    l.includes("muelle")
  )
    return (
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
        <path d="M2 21c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1 .6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1" />
        <path d="M19.38 20A11.6 11.6 0 0 0 21 14l-9-4-9 4c0 2.9.94 5.34 2.81 7.76" />
        <path d="M19 13V7a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v6" />
        <path d="M12 10v4" />
        <path d="M12 3v4" />
      </svg>
    );
}

export default function ServicePage() {
  const params = useParams<{ id: string }>();
    const id = params.id;

  const [dict, setDict] = useState<any>(null);

  useEffect(() => {
    getDictionary().then(setDict);
  }, []);

  const dataset = serviceEn;
  const cityData = dataset.find((c) => c.id === id);

  if (!cityData)
    return <p className="text-white p-10">Service not found: {id}</p>;
  if (!dict) return null;

  const faSource = FAMap;
  const faData = faSource[cityData.FA as keyof typeof faSource] || [];

  const testimonialsSource = TestimonialsMap;
  const testimonialData =
    testimonialsSource[cityData.Testi as keyof typeof testimonialsSource] || [];

  return (
    <div className="bg-black text-white">
      <section
        className="relative flex min-h-[100dvh] items-end"
      >
        <Image
          src={cityData.hero.image.src}
          alt={cityData.hero.image.alt}
          fill
          priority
          className="object-cover object-center"
          sizes="100vw"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black via-black/70 to-black/50" />

        <div className="relative z-10 w-full max-w-7xl mx-auto px-5 sm:px-8 lg:px-16 pt-28 pb-24 sm:pb-20">
          <h1 className="font-serif font-bold leading-tight text-3xl sm:text-4xl lg:text-5xl xl:text-6xl max-w-3xl">
            {cityData.hero.h1}
          </h1>
          <h2 className="mt-3 max-w-xl text-[0.95rem] leading-relaxed text-white/85 sm:text-lg [text-shadow:0_1px_3px_rgba(0,0,0,0.85)]">
            {cityData.hero.h2}
          </h2>
          <div className="mt-5 flex flex-wrap gap-3">
            <a href="/book">
              <Button className={`px-6 sm:px-8 h-auto min-h-11 sm:min-h-12 py-2.5 max-w-full whitespace-normal text-center leading-snug ${btnPrimary}`}>
                {cityData.hero.cta.book}
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </a>
            <a href={`tel:${cityData.hero.cta.phone.replace(/\D/g, "")}`}>
              <Button
                variant="outline"
                className="rounded-full px-6 sm:px-8 uppercase tracking-widest text-xs font-semibold h-auto min-h-11 sm:min-h-12 py-2.5 max-w-full whitespace-normal text-center leading-snug border-white text-white hover:bg-white hover:text-black"
              >
                <Phone className="mr-2 h-4 w-4" />
                {cityData.hero.cta.phone}
              </Button>
            </a>
          </div>
          {cityData.hero.description && (
            <p className="mt-5 max-w-2xl text-[0.95rem] leading-relaxed text-white/85 sm:text-lg [text-shadow:0_1px_3px_rgba(0,0,0,0.85)]">
              "{cityData.hero.description}"
            </p>
          )}
        </div>
      </section>

      {cityData.trustBar && cityData.trustBar.length > 0 && (
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
        grid-template-columns: repeat(${cityData.trustBar.length}, 1fr);
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
              color: "rgba(255,255,255,0.7)",
              marginBottom: 24,
              fontWeight: 500,
            }}
          >
            {"Trusted by thousands across North America"}
          </p>

          <div className="trust-bar-grid">
            {cityData.trustBar.map((item, i) => (
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
      {/* ── BODY CONTENT ── */}
      {cityData.bodyContent && (
        <section className="bg-black">
          <div className="mx-auto max-w-7xl px-5 sm:px-8 lg:px-16 mt-6 mb-4">
            <h2 className="font-serif font-bold text-3xl sm:text-4xl lg:text-5xl leading-tight">
              {cityData.bodyContent.h2
                .split("Viaro")
                .map((part: string, i: number, arr: string[]) => (
                  <React.Fragment key={i}>
                    {part}
                    {i < arr.length - 1 && (
                      <span className="text-muted2">Viaro</span>
                    )}
                  </React.Fragment>
                ))}
            </h2>
            <h3 className="text-sm font-bold uppercase tracking-widest text-primary mb-8">
              {cityData.bodyContent.h3}
            </h3>
            <div className="max-w-3xl space-y-5 mb-16 text-left md:text-justify">
              {cityData.bodyContent.content?.map((p, i) => (
                <p
                  key={i}
                  className="text-sm sm:text-base text-neutral-400 leading-relaxed"
                >
                  {p}
                </p>
              ))}
            </div>
            <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
              {cityData.bodyContent.airports.map((airport, i) => (
                <div
                  key={i}
                  className="group relative overflow-hidden rounded-2xl h-80"
                >
                  <a
                    href={airport.url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <img
                      src={airport.image}
                      alt={airport.region}
                      className="w-full h-full object-cover transition duration-500 group-hover:opacity-40"
                    />
                  </a>
                  <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition duration-500 pointer-events-none z-10"></div>
                  <div className="absolute bottom-0 left-0 right-0 bg-black/70 p-5 z-20">
                    <h4 className="text-primary text-lg font-serif font-bold mb-1 leading-tight">
                      {airport.region}
                    </h4>
                    <p className="text-xs text-neutral-300 leading-relaxed">
                      {airport.description}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {cityData.extraContent && cityData.extraContent.length > 0 && (
        <section className="py-10 sm:py-24 bg-black">
          <div className="mx-auto max-w-7xl px-5 sm:px-8 lg:px-16 space-y-24">
            {cityData.extraContent.map((section, i) => (
              <div key={i}>
                <div className="flex items-center gap-4 ">
                  <div className="h-px w-8 bg-primary flex-shrink-0" />

                  <div className="flex flex-col">
                    <h3 className="font-serif font-bold text-2xl sm:text-3xl">
                      {section.h3}
                    </h3>

                    <h2 className="text-sm font-bold uppercase tracking-widest text-primary mt-2">
                      {section.h2}
                    </h2>
                  </div>
                </div>
                <div className="max-w-3xl space-y-5 mb-16">
                  {section.content?.map((p, i) => (
                    <p
                      key={i}
                      className="text-sm sm:text-base text-neutral-400 leading-relaxed"
                    >
                      {p}
                    </p>
                  ))}
                </div>
                {(section.quote || section.image) && (
                  <div
                    className={`grid gap-8 mb-10 ${section.image ? "lg:grid-cols-2 lg:items-center" : ""}`}
                  >
                    {section.quote && (
                      <blockquote className="relative pl-8 border-l-2 border-primary">
                        <div className="absolute -left-3 top-0 h-6 w-6 rounded-full bg-primary/20 border border-primary/40 flex items-center justify-center">
                          <span className="text-primary text-xs font-bold">
                            "
                          </span>
                        </div>
                        <div className="text-sm sm:text-base text-neutral-300 leading-relaxed italic">
                          {section.quote}
                        </div>
                      </blockquote>
                    )}
                    {section.image && (
                      <div className="relative w-full aspect-[16/9] rounded-2xl overflow-hidden">
                        <Image
                          src={section.image.src}
                          alt={section.image.alt}
                          fill
                          className="object-cover object-[50%_80%]"
                          sizes="(max-width: 1024px) 100vw, 50vw"
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent" />
                      </div>
                    )}
                  </div>
                )}
                {section.items && (
                  <div className="grid gap-6 sm:grid-cols-3 mb-10">
                    {section.items.map((item, idx) => (
                      <div
                        key={item.label}
                        className="group flex gap-4 border border-white/5 rounded-2xl p-5 bg-neutral-900/30 hover:border-primary/30 hover:bg-neutral-900/60 transition-all duration-300"
                      >
                        <div className="flex-shrink-0 mt-1 h-7 w-7 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center group-hover:bg-primary/20 transition-colors">
                          <div className="w-3 h-3 bg-primary rounded-full shadow-[0_0_10px_rgba(59,130,246,0.8)]"></div>
                        </div>
                        <div>
                          <p className="text-sm sm:text-base font-semibold text-white mb-1 group-hover:text-primary transition-colors">
                            {item.label}
                          </p>
                          <p className="text-sm text-neutral-400 leading-relaxed">
                            {item.desc}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {section.list && (
                  <>
                    {section.desc && (
                      <p className="text-sm text-neutral-300 mb-6 leading-relaxed">
                        {section.desc}
                      </p>
                    )}
                    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 mb-10">
                      {section.list.map((item, idx) => (
                        <li key={idx} className="flex gap-3 items-start group">
                          <div className="flex-shrink-0 mt-0.5 h-5 w-5 rounded-full bg-primary/10 border border-primary/30 flex items-center justify-center group-hover:bg-primary/20 transition-colors">
                            <span className="text-primary text-[10px] font-bold">
                              ✓
                            </span>
                          </div>
                          <span className="text-sm text-neutral-300 leading-relaxed group-hover:text-white transition-colors">
                            {item}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
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
                            <svg
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth={1.5}
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              width={20}
                              height={20}
                              className="shrink-0 text-brand group-hover:text-primary transition-colors duration-200"
                            >
                              <circle cx="12" cy="5" r="3" />
                              <path d="M12 8v13M5 11a7 7 0 0 0 14 0" />
                            </svg>
                          </div>
                          <p className="text-neutral-400 text-sm leading-relaxed">
                            {p.terminals}
                          </p>
                          <span className="inline-block mt-4 text-xs font-semibold uppercase tracking-widest text-primary bg-primary/10 border border-primary/20 rounded-full px-2 py-0.5">
                            {p.note}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {section.cta && (
                  <div className="text-center">
                    <a href="/book">
                      {/*
                        * Wraps instead of overflowing: these CTA strings are long enough
                        * ("Check Cruise Port Availability & Rates →") that a nowrap,
                        * fixed-height button pushed the whole page wider than a 375px
                        * viewport. h-auto + whitespace-normal lets the label use two lines.
                        */}
                      <Button className={`px-8 h-auto min-h-11 sm:min-h-12 sm:h-auto max-w-full whitespace-normal text-center leading-snug py-2.5 ${btnPrimary}`}>
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

      {/* ── PRICING ── */}
      <section className="py-12 sm:py-24 bg-neutral-950">
        <div className="mx-auto max-w-7xl px-5 sm:px-8 lg:px-16">
          <h2 className="font-serif font-bold text-3xl sm:text-4xl lg:text-5xl leading-tight text-center mb-12 whitespace-pre-line">
            {cityData.pricing.h2}
          </h2>
          <div className="grid gap-6 sm:grid-cols-3">
            {cityData.pricing.vehicles.map((p) => (
              <div
                key={p.type}
                className="relative flex flex-col border border-primary/40 rounded-2xl bg-neutral-900/40 p-6 sm:p-8 hover:border-primary transition-all duration-300"
              >
                <h3 className="font-serif font-bold text-xl sm:text-2xl mb-2">
                  {p.type}
                </h3>
                <p className="text-xs font-semibold uppercase tracking-widest text-neutral-400 mb-0.5">
                  {"Starting at"}
                </p>
                <p className="text-4xl font-bold text-primary mb-1">
                  ${p.price}
                </p>
                <p className="text-sm text-neutral-400 mb-6">
                  {p.passengers} {"passengers"}
                </p>
                <div className="mb-5">
                  <p className="text-xs uppercase tracking-widest text-neutral-400 mb-2">
                    {"Models"}
                  </p>
                  <ul className="space-y-1">
                    {p.models.map((m, i) => (
                      <li key={i} className="text-sm text-neutral-300">
                        · {m}
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="flex-grow">
                  <p className="text-xs uppercase tracking-widest text-neutral-400 mb-2">
                    {"Included"}
                  </p>
                  <ul className="space-y-1">
                    {p.extras.map((e, i) => (
                      <li
                        key={i}
                        className="flex items-start gap-2 text-sm text-neutral-400"
                      >
                        <span className="text-primary flex-shrink-0">✓</span>{" "}
                        {e}
                      </li>
                    ))}
                  </ul>
                </div>
                <a
                  href="/book"
                  className="mt-8 block"
                >
                  <Button
                    className={`w-full h-auto min-h-11 py-2 ${btnPrimary} whitespace-normal text-center leading-snug`}
                  >
                    {`Book ${p.type}`} →
                  </Button>
                </a>
              </div>
            ))}
          </div>
          <div className="mt-10 text-center">
            <a href="/book">
              {/* Same long-label wrapping as the section CTA above. */}
              <Button className={`px-8 h-auto min-h-11 sm:min-h-12 sm:h-auto max-w-full whitespace-normal text-center leading-snug py-2.5 ${btnPrimary}`}>
                {cityData.pricing.cta}
              </Button>
            </a>
          </div>
        </div>
      </section>

      {/* ── TESTIMONIALS ── */}
      <section className="pt-16 sm:pt-24">
        <div className="mx-auto max-w-7xl px-5 sm:px-8 lg:px-16 mb-10 text-center">
          <h2 className="font-serif font-bold text-3xl sm:text-4xl lg:text-5xl leading-tight">
            {" WHAT OUR TRAVELERS SAY"}
          </h2>
        </div>
        <Testimonials data={testimonialData} />
      </section>

      {/* ── FAQ ── */}
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
    </div>
  );
}
