"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { getDictionary } from "@/lib/get-dictionary";
import { Button } from "@/components/ui/button";
import { ArrowRight, Phone } from "lucide-react";

const btnPrimary =
  "bg-primary text-white hover:bg-brand2 rounded-full uppercase tracking-widest text-xs font-semibold transition-colors";

export default function TermsContent() {
  const params = useParams();
    const [dict, setDict] = useState<any>(null);

  useEffect(() => {
    getDictionary().then(setDict);
  }, []);

  if (!dict) return null;
  const t = dict.terms;

  return (
    <main className="bg-black text-white">

      {/* ── HERO ── */}
      {/* Top padding clears the fixed navbar; the bottom is kept short so the first
          section follows the title rather than floating a screen below it. */}
      <section className="relative w-full overflow-hidden pt-32 pb-10 sm:pt-44 sm:pb-14 bg-neutral-950">
        <div className="absolute inset-0 bg-gradient-to-b from-black via-neutral-950 to-black" />
        <div className="relative z-10 mx-auto max-w-7xl px-5 sm:px-8 lg:px-16">
          <p className="text-xs font-bold uppercase tracking-[0.08em] text-primary mb-4">
            {t.hero.eyebrow}
          </p>
          <h1 className="font-serif font-bold leading-tight text-3xl sm:text-4xl lg:text-5xl xl:text-6xl max-w-3xl">
            {t.hero.title}
          </h1>
          <p className="mt-4 text-sm sm:text-base text-white/50 max-w-xl leading-relaxed">
            {t.hero.subtitle}
          </p>
        </div>
      </section>

      {/* ── SECTIONS ── */}
      <section className="pt-8 pb-16 sm:pt-12 sm:pb-24 bg-black">
        <div className="mx-auto max-w-7xl px-5 sm:px-8 lg:px-16 space-y-14 sm:space-y-20">
          {t.sections.map((section: any, i: number) => (
            <div key={i}>
              <div className="flex items-center gap-4 mb-4">
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

              {section.intro && (
                <p className="text-sm sm:text-base text-neutral-400 leading-relaxed max-w-3xl mb-10">
                  {section.intro}
                </p>
              )}

              <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {section.items.map((item: string, idx: number) => (
                  <div
                    key={idx}
                    className="group flex gap-4 border border-white/5 rounded-2xl p-5 bg-neutral-900/30 hover:border-primary/30 hover:bg-neutral-900/60 transition-all duration-300"
                  >
                    <div className="flex-shrink-0 mt-1 h-7 w-7 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center group-hover:bg-primary/20 transition-colors">
                      <span className="text-primary text-xs font-bold">{idx + 1}</span>
                    </div>
                    <p className="text-sm sm:text-base text-neutral-300 leading-relaxed">
                      {item}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="py-16 bg-neutral-950 border-t border-white/5">
        <div className="mx-auto max-w-7xl px-5 sm:px-8 lg:px-16 text-center">
          <p className="text-xs font-bold uppercase tracking-widest text-primary mb-4">{t.cta.eyebrow}</p>
          <h2 className="font-serif font-bold text-3xl sm:text-4xl mb-4">{t.cta.title}</h2>
          <p className="text-sm sm:text-base text-white/50 max-w-xl mx-auto mb-8">{t.cta.subtitle}</p>
          <div className="flex flex-wrap gap-4 justify-center">
            <a href="/book">
              <Button className={`px-8 h-11 sm:h-12 ${btnPrimary}`}>
                {t.cta.book}
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </a>
            <a href="tel:2066728281">
              <Button
                variant="outline"
                className="rounded-full px-6 sm:px-8 uppercase tracking-widest text-xs font-semibold h-11 sm:h-12 border-white text-white hover:bg-white hover:text-black"
              >
                <Phone className="mr-2 h-4 w-4" />
                (206) 672-8281
              </Button>
            </a>
          </div>
        </div>
      </section>

    </main>
  );
}