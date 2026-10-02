"use client";
import {
  ArrowRight,
  ChevronDown,
  ChevronUp,
  MapPin,
  Phone,
} from "lucide-react";
import { SafeImage } from "@/components/ui/SafeImage";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { locationsTestimonials } from "@/data/Tetimonials";
import { Testimonials } from "../testimonials";
import { LocationsFa } from "@/data/Fa";
import { FA } from "../FA";
import UsMapScroll from "../UsMapScroll";
import { Button } from "../ui/button";
import { getDictionary } from "@/lib/get-dictionary";
import Link from "next/link";

const btnPrimary =
  "bg-primary text-white hover:bg-brand2 rounded-full uppercase tracking-widest text-xs font-semibold transition-colors";

const STEP = 5;

const TRUST_METRICS = [
  {
    value: "5.0",
    labelKey: "ratingLabel",
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
  {
    value: "Live",
    labelKey: "flightLabel",
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
        <path d="M22 16.5H2M2 16.5l4-8 4 4 4-2 4-4 2 2-4 8z" />
        <path d="M6 19.5h12" />
      </svg>
    ),
  },
  {
    value: "24/7",
    labelKey: "supportLabel",
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
    value: "100%",
    labelKey: "licensedLabel",
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
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10" />
        <path d="m9 12 2 2 4-4" />
      </svg>
    ),
  },
];

export default function LocationsContent() {
  const params = useParams();
    const [dict, setDict] = useState<any>(null);
  const [shownCount, setShownCount] = useState<Record<string, number>>({});

  const getShown = (regionId: string) => shownCount[regionId] ?? STEP;

  const showMore = (regionId: string, total: number) => {
    setShownCount((prev) => ({
      ...prev,
      [regionId]: Math.min((prev[regionId] ?? STEP) + STEP, total),
    }));
  };

  const showLess = (regionId: string) => {
    setShownCount((prev) => ({ ...prev, [regionId]: STEP }));
  };

  useEffect(() => {
    const loadDict = async () => {
      const data = await getDictionary();
      setDict(data);
    };
    loadDict();
  }, []);

  const testimonios =
    locationsTestimonials;
  const fa = LocationsFa;
  if (!dict) return <div>Loading...</div>;
  const t = dict.locations;
  const locations2 = [
    {
      city: "New York City",
      url: "new-york",
      airport: "JFK",
      description: "The cultural capital of the world. Iconic skyscrapers, Broadway lights, and unstoppable energy.",
      image: "/images/ImagenNewYork.png",
    },
    {
      city: "Los Angeles",
      url: "los-angeles-lax",
      airport: "LAX",
      description: "Where Hollywood meets the Pacific. Film, beaches, and the ultimate California lifestyle.",
      image: "/images/ImagenLA.png",
    },
    {
      city: "Seattle",
      url: "seattle-seatac-airport",
      airport: "SEA",
      description: "Emerald City with iconic Space Needle, vibrant waterfront, and a thriving tech scene.",
      image: "/images/ImagenSeattle.png",
    },
    {
      city: "Las Vegas",
      url: "las-vegas",
      airport: "LAS",
      description: "The world's entertainment capital. Luxury resorts, nightlife, and nonstop excitement.",
      image: "/images/ImagenLasVegas.png",
    },
    {
      city: "Chicago",
      url: "chicago",
      airport: "ORD",
      description: "Striking architecture, legendary jazz, and one of the country's finest culinary scenes.",
      image: "/images/ImagenChicago.png",
    },
    {
      city: "San Francisco",
      url: "san-francisco",
      airport: "SFO",
      description: "Iconic bridges, scenic hills, and the heart of Silicon Valley innovation.",
      image: "/images/ImagenSanFrancisco.png",
    },
  ];

  const locations = [
    {
      region: "Western United States",
      cities: [
        {
          name: "Aspen / Vail, CO (ASE, EGE)",
          slug: "aspen-vail",
          desc: "Private jet pickup, ski resort transfers, luxury mountain retreat transportation.",
        },
        {
          name: "Denver, CO (DEN, APA, BJC)",
          slug: "denver",
          desc: "Airport transfers, FBO service at Centennial, ski resort connections.",
        },
        {
          name: "Honolulu, HI (HNL)",
          slug: "honolulu",
          desc: "Airport service, resort transfers, island tours and hourly chauffeur.",
        },
        {
          name: "Jackson Hole, WY (JAC)",
          slug: "jackson-hole",
          desc: "Private aviation pickup, ski resort transfers, ranch and estate transportation.",
        },
        {
          name: "Las Vegas, NV (LAS, VGT, HND)",
          slug: "las-vegas",
          desc: "Airport and FBO transfers, convention service, 24/7 entertainment and event travel.",
        },
        {
          name: "Long Beach, CA (LGB)",
          slug: "long-beach",
          desc: "Airport transfers, cruise port service, Los Angeles area transportation.",
        },
        {
          name: "Los Angeles, CA (LAX, VNY, BUR)",
          slug: "los-angeles-lax",
          desc: "Airport service, FBO at Van Nuys, studio and entertainment industry travel.",
        },
        {
          name: "Oakland, CA (OAK)",
          slug: "oakland",
          desc: "Airport transfers, East Bay corporate service, Bay Area coverage.",
        },
        {
          name: "Orange County, CA (SNA, JWA)",
          slug: "orange-county",
          desc: "John Wayne Airport transfers, beach resort service, Newport and Laguna travel.",
        },
        {
          name: "Palm Springs, CA (PSP, TRM)",
          slug: "palm-springs",
          desc: "Airport service, golf resort transfers, desert retreat transportation.",
        },
        {
          name: "Phoenix / Scottsdale, AZ (PHX, SDL)",
          slug: "phoenix",
          desc: "Airport transfers, FBO at Scottsdale, golf resort and spa transportation.",
        },
        {
          name: "Portland, OR (PDX, HIO)",
          slug: "portland",
          desc: "Airport service, wine country tours, corporate and leisure travel.",
        },
        {
          name: "Sacramento, CA (SMF)",
          slug: "sacramento",
          desc: "Airport transfers, Napa Valley wine tours, state capital corporate service.",
        },
        {
          name: "Salt Lake City, UT (SLC)",
          slug: "salt-lake-city",
          desc: "Airport service, ski resort transfers, corporate and event transportation.",
        },
        {
          name: "San Diego, CA (SAN, CRQ, MYF)",
          slug: "san-diego",
          desc: "Airport transfers, beach resort service, corporate and leisure travel.",
        },
        {
          name: "San Francisco Bay Area (SFO, SJC, OAK)",
          slug: "san-francisco",
          desc: "Airport service, Napa Valley wine tours, Silicon Valley corporate travel.",
        },
        {
          name: "Seattle, WA (SEA, BFI)",
          slug: "seattle-seatac-airport",
          desc: "Sea-Tac and Boeing Field transfers, Alaska Pier 66/91 cruise port transfer service, tech campus transportation.",
        },
      ],
    },
    {
      region: "Central United States",
      cities: [
        {
          name: "Atlanta, GA (ATL, PDK)",
          slug: "atlanta",
          desc: "Hartsfield-Jackson transfers, FBO pickup at DeKalb-Peachtree, corporate travel.",
        },
        {
          name: "Austin, TX (AUS)",
          slug: "austin",
          desc: "Airport transfers, tech campus pickups, SXSW and event transportation.",
        },
        {
          name: "Chicago, IL (ORD, MDW, DPA)",
          slug: "chicago",
          desc: "O'Hare and Midway transfers, FBO service at DuPage, corporate and hourly service.",
        },
        {
          name: "Cincinnati, OH (CVG)",
          slug: "cincinnati",
          desc: "Airport transfers, corporate headquarters visits, Midwest business travel.",
        },
        {
          name: "Cleveland, OH (CLE)",
          slug: "cleveland",
          desc: "Airport service, Cleveland Clinic medical transportation, corporate travel.",
        },
        {
          name: "Columbus, OH (CMH)",
          slug: "columbus",
          desc: "Airport transfers, Ohio State events, corporate and convention service.",
        },
        {
          name: "Dallas / Fort Worth, TX (DFW, DAL, ADS)",
          slug: "dallas",
          desc: "Airport transfers, FBO pickup at Addison, corporate roadshows and meetings.",
        },
        {
          name: "Detroit, MI (DTW, PTK)",
          slug: "detroit",
          desc: "Airport service, FBO at Oakland County, automotive industry travel.",
        },
        {
          name: "Houston, TX (IAH, HOU, SGR)",
          slug: "houston",
          desc: "Airport transfers, medical center transportation, FBO at Sugar Land.",
        },
        {
          name: "Indianapolis, IN (IND)",
          slug: "indianapolis",
          desc: "Airport service, convention transportation, Indianapolis 500 and event travel.",
        },
        {
          name: "Milwaukee, WI (MKE)",
          slug: "milwaukee",
          desc: "Airport transfers, corporate meetings, event transportation.",
        },
        {
          name: "Minneapolis, MN (MSP, FCM)",
          slug: "minneapolis",
          desc: "Airport service, FBO at Flying Cloud, corporate headquarters travel.",
        },
        {
          name: "Nashville, TN (BNA, JWN)",
          slug: "nashville",
          desc: "Airport transfers, music industry events, wedding and celebration transportation.",
        },
        {
          name: "New Orleans, LA (MSY, NEW)",
          slug: "new-orleans",
          desc: "Airport service, cruise port transfers, French Quarter hotel pickups.",
        },
        {
          name: "San Antonio, TX (SAT)",
          slug: "san-antonio",
          desc: "Airport transfers, convention center service, leisure and corporate travel.",
        },
        {
          name: "St. Louis, MO (STL, SUS)",
          slug: "st-louis",
          desc: "Airport service, FBO at Spirit of St. Louis, corporate transportation.",
        },
      ],
    },
    {
      region: "Eastern United States",
      cities: [
        {
          name: "Boston, MA (BOS, BED)",
          slug: "boston",
          desc: "Logan Airport transfers, private jet pickup at Hanscom Field, university and hospital visits.",
        },
        {
          name: "Charleston, SC (CHS)",
          slug: "charleston",
          desc: "Historic district hotel transfers, cruise port service, corporate and leisure travel.",
        },
        {
          name: "Charlotte, NC (CLT)",
          slug: "charlotte",
          desc: "Airport transfers, corporate meetings, sporting event transportation.",
        },
        {
          name: "Jacksonville, FL (JAX)",
          slug: "jacksonville",
          desc: "Airport and cruise port transfers, golf resort transportation, military family travel.",
        },
        {
          name: "Miami / South Florida (MIA, FLL, PBI, OPF)",
          slug: "miami",
          desc: "Cruise port transfers, airport service, FBO pickup at Opa-locka, Palm Beach estates.",
        },
        {
          name: "Naples / Ft. Myers, FL (RSW, APF)",
          slug: "naples",
          desc: "Resort and golf club transfers, private aviation pickup, seasonal luxury travel.",
        },
        {
          name: "New York Metro (JFK, LGA, EWR, TEB, HPN)",
          slug: "new-york",
          desc: "FBO tarmac service at Teterboro, Westchester corporate travel, Manhattan transfers.",
        },
        {
          name: "Orlando, FL (MCO, SFB, ORL)",
          slug: "orlando",
          desc: "Family vacation transfers, convention center service, theme park and resort transportation.",
        },
        {
          name: "Philadelphia, PA (PHL, PNE)",
          slug: "philadelphia",
          desc: "Airport transfers, corporate travel, private aviation at Northeast Philadelphia.",
        },
        {
          name: "Pittsburgh, PA (PIT)",
          slug: "pittsburgh",
          desc: "Airport service, corporate meetings, healthcare facility transportation.",
        },
        {
          name: "Raleigh-Durham, NC (RDU)",
          slug: "raleigh-durham",
          desc: "Research Triangle corporate travel, airport transfers, medical center visits.",
        },
        {
          name: "Savannah, GA (SAV)",
          slug: "savannah",
          desc: "Historic district tours, airport transfers, wedding and event transportation.",
        },
        {
          name: "Tampa, FL (TPA, PIE)",
          slug: "tampa",
          desc: "Cruise port transfers, airport service, corporate and leisure travel.",
        },
        {
          name: "Washington, DC (IAD, DCA, JYO)",
          slug: "washington-dc",
          desc: "Government and diplomatic travel, airport transfers, FBO service at Leesburg.",
        },
      ],
    },
    {
      region: "Canada",
      note: "All Canada trips require 8-hour minimum due to potential border/customs delays.",
      cities: [
        {
          name: "Toronto, ON (YYZ, YTZ)",
          slug: "toronto",
          desc: "Pearson Airport transfers, Billy Bishop downtown service, cross-border corporate travel.",
        },
        {
          name: "Vancouver, BC (YVR)",
          slug: "vancouver",
          desc: "Airport service, Alaska cruise port transfers, US-Canada border expertise.",
        },
      ],
    },
    {
      region: "Costa Rica",
      cities: [
        {
          name: "Liberia, CR (LIR)",
          slug: "costa-rica",
          desc: "Pacific coast resort service & eco-lodge transportation.",
        },
        {
          name: "San José, CR (SJO)",
          slug: "costa-rica",
          desc: "Capital city airport, golf transfers, business travel & special events.",
        },
      ],
    },
  ];

  const scrollToRegion = (id: string) => {
    const section = document.getElementById(id);
    if (section) {
      const headerOffset = 100;
      const elementPosition = section.getBoundingClientRect().top;
      const offsetPosition =
        elementPosition + window.pageYOffset - headerOffset;
      window.scrollTo({ top: offsetPosition, behavior: "smooth" });
    }
  };

  return (
    <main>
      <section
        id="inicio"
        className="relative min-h-screen flex items-center pt-0"
      >
        <div className="absolute inset-0">
          {" "}
          <SafeImage
            src="/images/ImagenLocations1.png"
            alt="Luxury vehicle parked in front of a modern building"
            fill
            className="object-cover"
            priority
          />
          <div className="absolute inset-0 bg-background/75" />
        </div>
        <div className="relative z-20 mx-auto w-full max-w-7xl px-5 sm:px-8 lg:px-16 pt-28 pb-16">
          <div className="max-w-3xl">
            <p className="mb-3 text-xs sm:text-sm font-semibold uppercase tracking-[0.08em] text-brand [text-shadow:0_1px_3px_rgba(0,0,0,0.9),_0_4px_12px_rgba(0,0,0,0.6)]">
              {t.hero.subtitle}
            </p>
            <p className="mb-3 text-xs sm:text-sm font-semibold uppercase tracking-[0.08em] text-brand [text-shadow:0_1px_3px_rgba(0,0,0,0.9),_0_4px_12px_rgba(0,0,0,0.6)]">
              {t.subtitle}
            </p>
            <h1 className="font-serif text-[2rem] font-bold leading-tight tracking-tight text-foreground sm:text-6xl lg:text-7xl text-balance [overflow-wrap:anywhere]">
              {t.hero.title}
            </h1>
            <p className="mt-4 mb-6 text-sm sm:text-base font-semibold uppercase tracking-[0.08em] text-white/90 [text-shadow:0_1px_3px_rgba(0,0,0,0.85)]">
              {t.hero.description}
            </p>
            <div className="flex flex-wrap gap-3">
              <a href="/book">
                <Button className={`px-6 sm:px-8 h-auto min-h-11 sm:min-h-12 py-2.5 max-w-full whitespace-normal text-center leading-snug ${btnPrimary}`}>
                  {t.buttons.bookNow}
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </a>
              <a href="tel:2066728281">
                <Button
                  variant="outline"
                  className="rounded-full px-6 sm:px-8 uppercase tracking-widest text-xs font-semibold h-auto min-h-11 sm:min-h-12 py-2.5 max-w-full whitespace-normal text-center leading-snug border-white text-white hover:bg-white hover:text-black"
                >
                  <Phone className="mr-2 h-4 w-4" />
                  {t.buttons.callUs ?? "Call Us"}
                </Button>
              </a>
            </div>
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
    .tm-heading { font-size: 11px; }
    .tm-value { font-size: 22px; }
    .tm-icon svg { width: 28px; height: 28px; }
    .tm-grid { grid-template-columns: repeat(4, 1fr); }
    @media (max-width: 480px) {
      .tm-heading { font-size: 11px; letter-spacing: 0.1em; margin-bottom: 20px !important; }
      .tm-value { font-size: 14px; }
      .tm-label { font-size: 11px; }
      .tm-icon svg { width: 20px; height: 20px; }
      .tm-grid { gap: 8px !important; }
      .tm-item { gap: 6px !important; }
    }
  `}</style>

        <p
          className="tm-heading"
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
          className="tm-grid"
          style={{
            maxWidth: 900,
            margin: "0 auto",
            display: "grid",
            gap: 24,
            textAlign: "center",
          }}
        >
          {TRUST_METRICS.map((m) => (
            <div
              key={m.value}
              className="tm-item"
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 10,
              }}
            >
              <div
                className="tm-icon"
                style={{ color: "#89b4d4" }}
              >
                {m.icon}
              </div>
              <span
                className="tm-value"
                style={{ fontWeight: 700, color: "#fff", lineHeight: 1 }}
              >
                {m.value}
              </span>
              <span
                className="tm-label"
                style={{
                  fontSize: 11,
                  color: "rgba(255,255,255,0.7)",
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                }}
              >
                {t.stats[m.labelKey]}
              </span>
            </div>
          ))}
        </div>
      </section>
      <section className="relative py-20 overflow-hidden">
        <div className="absolute inset-0 z-0">
          <img
            src="/images/ImagenLocations2.png"
            alt=""
            className="w-full h-full object-cover"
            style={{ opacity: 20 }}
          />
          <div className="absolute inset-0 bg-black/60" />
        </div>

        {/* Contenido */}
        <div className="relative z-10 container mx-auto px-6 max-w-3xl text-center">
          <h2 className="text-3xl font-semibold mb-6">{t.intro.title}</h2>
          <h3 className="mb-4">{t.intro.subtitle}</h3>
          <p className="text-neutral-400 leading-relaxed">
            {t.intro.description}
          </p>
          <div className="mt-8 flex justify-center">
            <a href="/book">
              <Button className={`px-6 sm:px-8 h-auto min-h-11 sm:min-h-12 py-2.5 max-w-full whitespace-normal text-center leading-snug ${btnPrimary}`}>
                {t.buttons.bookNow}
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </a>
          </div>
        </div>
      </section>
      <UsMapScroll onSelectRegion={scrollToRegion} />
      <div className="max-w-7xl mx-auto py-20 px-6">
        <h2 className="text-2xl font-bold uppercase tracking-tighter text-white mb-10">
          {t.topCities}
        </h2>
        <div className="grid md:grid-cols-3 gap-8">
          {locations2.map((section, index) => {
            const card = (
              <div
                key={index}
                className="group relative overflow-hidden rounded-2xl cursor-pointer"
              >
                <img
                  src={section.image}
                  alt={section.city}
                  className="w-full h-80 object-cover transition duration-500 group-hover:brightness-50"
                />
                <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition duration-500">
                  <span className="text-white text-3xl sm:text-5xl font-bold tracking-widest">
                    {section.airport}
                  </span>
                </div>
                <div className="absolute bottom-0 left-0 right-0 bg-black/60 p-4">
                  <h3 className="text-white text-xl font-semibold">
                    {section.city}
                  </h3>
                  <p className="text-gray-300 text-sm">{section.description}</p>
                </div>
              </div>
            );

            return section.url ? (
              <Link key={index} href={`/service-area/${section.url}`}>
                {card}
              </Link>
            ) : (
              <div key={index}>{card}</div>
            );
          })}
        </div>
      </div>
      {/* ── REGIONS ── */}
      <div className="max-w-7xl mx-auto py-20 px-6">
        {locations.map((section) => {
          const regionId = section.region.toLowerCase().replace(/\s+/g, "-");
          const total = section.cities.length;
          const visibleCount = getShown(regionId);
          const hasMore = visibleCount < total;
          const wasExpanded = visibleCount > STEP;

          return (
            <div
              key={section.region}
              id={regionId}
              className="mb-24 scroll-mt-24"
            >
              <div className="flex items-center gap-4 mb-10">
                <h2 className="text-2xl font-bold uppercase tracking-tighter text-white">
                  {section.region}
                </h2>
                <div className="h-px bg-blue-500/30 flex-grow" />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {section.cities.map((city, i) => (
                  <div
                    key={city.name}
                    className={i >= visibleCount ? "md:block hidden" : "block"}
                  >
                    <Link
                      href={
                        city.slug ? `/service-area/${city.slug}` : "#"
                      }
                      className={
                        city.slug ? "block" : "block pointer-events-none"
                      }
                    >
                      <div className="p-4 rounded-2xl bg-neutral-900/50 border border-white/5 hover:border-primary/50 transition-all group cursor-pointer">
                        <div className="flex justify-between items-start mb-2">
                          <h3 className="text-lg font-semibold text-white group-hover:text-primary transition-colors">
                            {city.name}
                          </h3>
                          <MapPin className="w-5 h-5 text-brand group-hover:text-primary transition-colors duration-200" />
                        </div>
                        <p className="text-neutral-400 text-sm leading-relaxed">
                          {city.desc}
                        </p>
                        {city.slug && (
                          <span className="inline-flex items-center gap-1 mt-2 text-xs font-semibold uppercase tracking-widest text-primary bg-primary/10 border border-primary/20 rounded-full px-3 py-1">
                            {"View details"}{" "}
                            <ArrowRight className="w-3 h-3" />
                          </span>
                        )}
                      </div>
                    </Link>
                  </div>
                ))}
              </div>

              {/* Botones acordeón — solo en móvil */}
              <div className="md:hidden mt-4 flex flex-col gap-2">
                {hasMore && (
                  <button
                    onClick={() => showMore(regionId, total)}
                    className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border border-white/10 text-neutral-400 text-sm hover:bg-white/5 transition-all"
                  >
                    {`Show more (${Math.min(STEP, total - visibleCount)} of ${total - visibleCount} remaining)`}
                    <ChevronDown className="w-4 h-4" />
                  </button>
                )}
                {!hasMore && wasExpanded && (
                  <button
                    onClick={() => showLess(regionId)}
                    className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border border-white/10 text-neutral-400 text-sm hover:bg-white/5 transition-all"
                  >
                    {"Show less"}
                    <ChevronUp className="w-4 h-4" />
                  </button>
                )}
              </div>

              {section.note && (
                <p className="text-sm text-brand mb-6 mt-3">{section.note}</p>
              )}
            </div>
          );
        })}
      </div>
      {/* ── TESTIMONIALS ── */}
      <section>
        <div className="mx-auto max-w-7xl px-5 sm:px-8 lg:px-16 mb-2 text-center">
          <h2 className="font-serif font-bold text-3xl sm:text-4xl lg:text-5xl leading-tight">
            {"CLIENT EXPERIENCES"}
          </h2>
        </div>
        <Testimonials data={testimonios} />
      </section>
      {/* ── FAQ ── */}
      <section className="py-12 sm:py-24 bg-black">
        <div className="mx-auto max-w-7xl px-5 sm:px-8 lg:px-16">
          <h2 className="font-serif font-bold text-3xl sm:text-4xl lg:text-5xl leading-tight text-center mb-2">
            {"CHAUFFEUR SERVICE FAQs"}
          </h2>
          <FA data={fa} />
          <div className="mt-3 flex justify-center">
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
