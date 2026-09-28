import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Phone } from "lucide-react";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Privacy Policy | Viaro",
  description:
    "How Viaro collects, uses and protects personal information when you book and ride with us.",
};

/*
 * ⚠ Drafted from what the platform actually does (see viaro-backend: accounts, bookings,
 * trip tracking, wallet, SMS/email notifications, auth cookies). It has not been reviewed
 * by counsel — have it checked before launch, particularly the retention periods and any
 * state-specific rights (e.g. CCPA/CPRA, Washington's My Health My Data Act).
 */
const LAST_UPDATED = "28 September 2026";
const CONTACT_EMAIL = "reservations@viaro.io";

const SECTIONS: { title: string; intro?: string; items: string[] }[] = [
  {
    title: "Information we collect",
    intro:
      "We only ask for what we need to plan, run and bill your journey, and to keep you and our chauffeurs safe.",
    items: [
      "Account details: your name, email address, phone number and password (stored only as a secure hash).",
      "Booking details: pickup and drop-off addresses, dates and times, passenger count, flight numbers and any notes you add.",
      "Trip data: the chauffeur's live location during an active trip, so you can track your ride, and the route taken.",
      "Payment information: handled by our payment provider. We keep a reference to your card and your wallet balance, never the full card number.",
      "Communications: messages exchanged with your chauffeur through in-app chat, support tickets and ratings you leave.",
      "Technical data: essential cookies that keep you signed in, and basic logs (IP address, browser type) used for security.",
    ],
  },
  {
    title: "How we use your information",
    items: [
      "To quote, book, dispatch and complete your rides, including sharing pickup details with your assigned chauffeur.",
      "To send confirmations, trip updates and reminders by email or SMS.",
      "To process payments, refunds and wallet credit.",
      "To answer your support requests and resolve disputes.",
      "To keep the service safe, prevent fraud and meet our legal and licensing obligations.",
      "To improve our service. With your consent, to tell you about offers — you can opt out at any time.",
    ],
  },
  {
    title: "Who we share it with",
    intro: "We do not sell your personal information.",
    items: [
      "Your chauffeur, and the fleet operator they drive for, receive the details needed to complete your trip.",
      "Service providers acting on our behalf: payment processing, mapping and address lookup, email and SMS delivery, and cloud hosting.",
      "Authorities, when required by law or to protect the safety of passengers, chauffeurs or the public.",
      "A successor business, if Viaro is involved in a merger or acquisition — under the same protections described here.",
    ],
  },
  {
    title: "How long we keep it",
    items: [
      "Account information is kept while your account is open.",
      "Trip and payment records are kept for as long as tax, accounting and transport-licensing rules require.",
      "Live location is used only during an active trip; afterwards only the trip's route summary is retained.",
      "When you close your account we delete or anonymise your data, except where we must keep it by law.",
    ],
  },
  {
    title: "Your choices and rights",
    items: [
      "Access and correct your details at any time from My Account.",
      "Ask for a copy of your data, or for it to be deleted, by emailing us.",
      "Unsubscribe from marketing emails using the link in any message; trip notifications are part of the service.",
      "Control cookies in your browser. Blocking essential cookies will stop sign-in from working.",
      "Depending on where you live, you may have further rights under local law. We will honour them.",
    ],
  },
  {
    title: "Security",
    items: [
      "Connections to Viaro are encrypted, passwords are hashed and access to personal data is limited to staff who need it.",
      "No system is perfectly secure. If a breach affects your information, we will notify you as the law requires.",
    ],
  },
  {
    title: "Children",
    items: [
      "Viaro accounts are for adults aged 18 or over. Minors may travel when booked by and accompanied by, or with the consent of, a responsible adult.",
    ],
  },
];

const btnPrimary =
  "bg-primary text-white hover:bg-brand2 rounded-full uppercase tracking-widest text-xs font-semibold transition-colors";

export default function PrivacyPolicyPage() {
  return (
    <main className="bg-black text-white">
      {/* ── HERO ── */}
      <section className="relative w-full overflow-hidden bg-neutral-950 pb-14 pt-32 sm:pb-20 sm:pt-44">
        <div className="absolute inset-0 bg-gradient-to-b from-black via-neutral-950 to-black" />
        <div className="relative z-10 mx-auto max-w-7xl px-5 sm:px-8 lg:px-16">
          <p className="mb-4 text-xs font-bold uppercase tracking-[0.08em] text-brand">Legal</p>
          <h1 className="max-w-3xl font-serif text-3xl font-bold leading-tight sm:text-4xl lg:text-5xl">
            Privacy Policy
          </h1>
          <p className="mt-4 max-w-xl text-sm leading-relaxed text-white/60 sm:text-base">
            How Viaro collects, uses and protects your personal information when you book and
            ride with us.
          </p>
          <p className="mt-6 text-xs uppercase tracking-widest text-white/40">
            Last updated {LAST_UPDATED}
          </p>
        </div>
      </section>

      {/* ── SECTIONS ── */}
      <section className="bg-black py-12 sm:py-20">
        <div className="mx-auto max-w-4xl space-y-14 px-5 sm:space-y-16 sm:px-8">
          {SECTIONS.map((section, i) => (
            <div key={section.title}>
              <div className="mb-5 flex items-center gap-4">
                <span className="text-xs font-bold tabular-nums text-brand">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <div className="h-px w-8 flex-shrink-0 bg-primary" />
                <h2 className="font-serif text-2xl font-bold sm:text-3xl">{section.title}</h2>
              </div>
              {section.intro ? (
                <p className="mb-5 text-sm leading-relaxed text-neutral-400 sm:text-base">
                  {section.intro}
                </p>
              ) : null}
              <ul className="space-y-3">
                {section.items.map((item) => (
                  <li
                    key={item}
                    className="flex gap-3 text-sm leading-relaxed text-neutral-300 sm:text-base"
                  >
                    <span aria-hidden className="mt-2.5 h-1 w-1 flex-shrink-0 rounded-full bg-brand" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          ))}

          <div className="rounded-2xl border border-white/10 bg-neutral-900/40 p-6 sm:p-8">
            <h2 className="font-serif text-2xl font-bold">Contact us</h2>
            <p className="mt-3 text-sm leading-relaxed text-neutral-400 sm:text-base">
              Questions about this policy, or a request about your data? Email{" "}
              <a href={`mailto:${CONTACT_EMAIL}`} className="text-brand underline underline-offset-4">
                {CONTACT_EMAIL}
              </a>{" "}
              or write to Viaro, 555 Andover Park W, Tukwila, WA 98188, United States. We may
              update this policy; the date above shows the latest version.
            </p>
            <p className="mt-3 text-sm text-neutral-400">
              See also our{" "}
              <Link href="/terms-condition" className="text-brand underline underline-offset-4">
                Terms &amp; Conditions
              </Link>
              .
            </p>
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="border-t border-white/5 bg-neutral-950 py-14 sm:py-16">
        <div className="mx-auto flex max-w-7xl flex-wrap justify-center gap-4 px-5 sm:px-8">
          <Link href="/book">
            <Button className={`h-11 px-8 sm:h-12 ${btnPrimary}`}>
              Book your ride
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </Link>
          <a href="tel:+12066728281">
            <Button
              variant="outline"
              className="h-11 rounded-full border-white px-6 text-xs font-semibold uppercase tracking-widest text-white hover:bg-white hover:text-black sm:h-12 sm:px-8"
            >
              <Phone className="mr-2 h-4 w-4" />
              (206) 672-8281
            </Button>
          </a>
        </div>
      </section>
    </main>
  );
}
