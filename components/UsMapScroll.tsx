"use client";
import React, { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { getDictionary } from "@/lib/get-dictionary";

interface UsMapScrollProps {
  onSelectRegion: (id: string) => void;
}

const UsMapScroll = ({ onSelectRegion }: UsMapScrollProps) => {

  const [dict, setDict] = useState<any>(null);

  useEffect(() => {
    const loadDict = async () => {
      const data = await getDictionary();
      setDict(data);
    };
    loadDict();
  }, []);

  if (!dict) return <div className="py-20 text-center text-white">Loading...</div>;

  const t = dict.map || {}; 

  const regions = [
    {
      id: "western-united-states",
      label: t.west || "West Coast",
      color: "from-blue-600/20",
    },
    {
      id: "central-united-states",
      label: t.central || "Central",
      color: "from-indigo-600/20",
    },
    {
      id: "eastern-united-states",
      label: t.east || "East Coast",
      color: "from-cyan-600/20",
    },
  ];

  return (
    <section className="py-10 bg-black overflow-hidden">
      <div className="max-w-6xl mx-auto px-6 text-center">
        <h2 className="text-4xl md:text-4xl font-black text-white mb-12">
          {t.title || "U.S. Service Regions"}
        </h2>

        <div className="relative w-full max-w-4xl mx-auto group/map">
          <div className="absolute inset-0 bg-blue-600/5 rounded-full blur-[120px] group-hover/map:bg-blue-600/10 transition-colors duration-1000"></div>

          <div className="relative w-full">
            <object
              type="image/svg+xml"
              data="/images/us.svg"
              className="w-full h-auto relative z-10 pointer-events-none opacity-80 group-hover/map:opacity-100 transition-opacity duration-700"
            />

            <div className="absolute inset-0 z-20 grid grid-cols-3">
              {regions.map((region) => (
                <div
                  key={region.id}
                  onClick={() => onSelectRegion(region.id)}
                  className="relative cursor-pointer group/region overflow-hidden"
                >
                  <div
                    className={`absolute inset-0 bg-gradient-to-b ${region.color} to-transparent opacity-0 group-hover/region:opacity-100 transition-all duration-500 ease-out`}
                  />

                  <div className="absolute bottom-10 left-1/2 -translate-x-1/2 opacity-0 group-hover/region:opacity-100 group-hover/region:-translate-y-2 transition-all duration-300">
                    <span className="bg-white/10 backdrop-blur-md border border-white/20 text-white text-[10px] px-3 py-1 rounded-full uppercase tracking-tighter whitespace-nowrap">
                      {t.select || "Select"} {region.label}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mt-16 relative z-30">
            <RegionButton
              onClick={() => onSelectRegion("canada")}
              label={t.canada || "Canada Support"}
              dotColor="bg-red-500"
              hoverBorder="hover:border-red-500/40"
            />
            <RegionButton
              onClick={() => onSelectRegion("costa-rica")}
              label={t.costarica || "Costa Rica Support"}
              dotColor="bg-brand"
              hoverBorder="hover:border-brand/40"
            />
          </div>
        </div>
      </div>
    </section>
  );
};

const RegionButton = ({ onClick, label, dotColor, hoverBorder }: any) => (
  <button
    onClick={onClick}
    className={`group py-5 px-8 rounded-2xl bg-neutral-900/50 backdrop-blur-sm border border-white/5 text-neutral-400 hover:text-white ${hoverBorder} transition-all duration-300 font-bold uppercase text-xs tracking-[0.08em] flex items-center justify-between`}
  >
    <div className="flex items-center gap-4">
      <span
        className={`w-2 h-2 rounded-full ${dotColor} shadow-[0_0_12px_rgba(255,255,255,0.2)] group-hover:scale-125 transition-transform`}
      />
      {label}
    </div>
    <svg
      className="w-4 h-4 opacity-0 group-hover:opacity-100 -translate-x-2 group-hover:translate-x-0 transition-all"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
    >
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
    </svg>
  </button>
);

export default UsMapScroll;