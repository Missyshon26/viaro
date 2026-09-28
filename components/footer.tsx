"use client";

import Link from "next/link";
import { Phone } from "lucide-react";
import { BrandLogo } from "@/components/brand-logo";

interface FooterProps {
  dict: any;
}

/** The 24/7 line. Same number the navbar and contact page use. */
const PHONE_DISPLAY = "(206) 672-8281";
const PHONE_HREF = "tel:+12066728281";

/*
 * Brand glyphs, drawn inline. lucide deprecated its brand icons, and a font or CDN icon
 * set would be one more request for three shapes. Each is a single-colour path, so it
 * takes the link's text colour like any other icon on the site.
 */
function InstagramIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.5" cy="6.5" r="0.6" fill="currentColor" stroke="none" />
    </svg>
  );
}

function FacebookIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="currentColor" aria-hidden>
      <path d="M13.5 21v-7.5h2.53l.38-2.94H13.5V8.69c0-.85.24-1.43 1.46-1.43h1.56V4.63A20.9 20.9 0 0 0 14.25 4.5c-2.25 0-3.79 1.37-3.79 3.9v2.16H7.92v2.94h2.54V21h3.04Z" />
    </svg>
  );
}

function LinkedInIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="currentColor" aria-hidden>
      <path d="M6.94 8.5H3.56V20h3.38V8.5ZM5.25 3A1.97 1.97 0 1 0 5.25 7a1.97 1.97 0 0 0 0-3.94ZM20.44 13.4c0-3.1-1.65-4.55-3.86-4.55a3.34 3.34 0 0 0-3.02 1.66V8.5h-3.37V20h3.37v-5.7c0-1.5.28-2.95 2.14-2.95 1.83 0 1.86 1.72 1.86 3.05V20h3.38v-6.6Z" />
    </svg>
  );
}

export function Footer({ dict }: FooterProps) {
  const serviceLinks = [
    { label: dict.footer_service_airport   ?? "Airport Transfers",        slug: "airport-transfers" },
    { label: dict.footer_service_corporate ?? "Corporate Transportation", slug: "corporate-transportation" },
    { label: dict.footer_service_fbo       ?? "FBO Crew Transportation",  slug: "fbo-crew-transportation" },
    { label: dict.footer_service_cruise    ?? "Cruise Port Transfers",    slug: "cruise-port-transfers" },
    { label: dict.footer_service_hourly    ?? "Hourly Chauffeur Hire",    slug: "hourly-chauffeur-hire" },
  ];

  const companyLinks = [
    { label: dict.footer_company_about   ?? "About Us", slug: "about-us" },
    { label: dict.footer_company_contact ?? "Contact",  slug: "contact" },
    { label: dict.footer_company_blog    ?? "Blog",     slug: "blog" },
    { label: dict.footer_company_faq     ?? "FAQ",      slug: "faq" },
  ];

  const socialLinks = [
    { name: "Instagram", url: "https://www.instagram.com/all_black_limo/?hl=es", Icon: InstagramIcon },
    { name: "Facebook",  url: "https://www.facebook.com/ALLBLACKLIMO/",           Icon: FacebookIcon },
    { name: "LinkedIn",  url: "https://linkedin.com/company/allblacklimo-llc/about/", Icon: LinkedInIcon },
  ];

  const linkCls = "text-sm text-muted-foreground transition-colors hover:text-brand";
  const headingCls = "text-xs font-semibold uppercase tracking-widest text-foreground";

  return (
    <footer className="border-t border-white/10 bg-neutral-950">
      <div className="mx-auto max-w-7xl px-5 py-12 sm:px-6 sm:py-16 lg:px-8">
        <div className="grid grid-cols-2 gap-x-6 gap-y-10 lg:grid-cols-4">
          {/* Brand + socials: full width on a phone, so the columns below pair up. */}
          <div className="col-span-2 flex flex-col items-start gap-6 lg:col-span-1">
            <Link href="/" aria-label="Viaro home">
              <BrandLogo height={44} />
            </Link>
            <ul className="flex items-center gap-3" aria-label="Viaro on social media">
              {socialLinks.map(({ name, url, Icon }) => (
                <li key={name}>
                  <a
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={name}
                    title={name}
                    className="flex h-10 w-10 items-center justify-center rounded-full border border-white/15 text-white/70 transition-colors hover:border-brand hover:text-brand"
                  >
                    <Icon />
                  </a>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h4 className={headingCls}>{dict.footer_services_title ?? "Services"}</h4>
            <ul className="mt-4 flex flex-col gap-3">
              {serviceLinks.map((link) => (
                <li key={link.slug}>
                  <Link href={`/black-car-service/${link.slug}`} className={linkCls}>
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h4 className={headingCls}>{dict.footer_company_title ?? "Company"}</h4>
            <ul className="mt-4 flex flex-col gap-3">
              {companyLinks.map((link) => (
                <li key={link.slug}>
                  <Link href={`/${link.slug}`} className={linkCls}>
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div className="col-span-2 lg:col-span-1">
            <h4 className={headingCls}>{dict.footer_hours_title ?? "Hours"}</h4>
            {/* It said "24/7 Service" and looked like a link but went nowhere — now it
                rings the line that is actually staffed around the clock. */}
            <a
              href={PHONE_HREF}
              className="group mt-4 inline-flex flex-col gap-1"
              aria-label={`24/7 service — call ${PHONE_DISPLAY}`}
            >
              <span className="text-xs font-semibold uppercase tracking-widest text-brand group-hover:underline group-hover:underline-offset-4">
                {dict.footer_hours_value ?? "24/7 Service"}
              </span>
              <span className="inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors group-hover:text-white">
                <Phone className="h-3.5 w-3.5" />
                {PHONE_DISPLAY}
              </span>
            </a>
          </div>
        </div>

        <div className="mt-12 flex flex-col-reverse items-start gap-4 border-t border-white/10 pt-8 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-muted-foreground">
            &copy; {new Date().getFullYear()} Viaro. {dict.footer_rights ?? "All rights reserved."}
          </p>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <Link
              href="/privacy-policy"
              className="text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:text-brand"
            >
              {dict.footer_privacy ?? "Privacy Policy"}
            </Link>
            <Link
              href="/terms-condition"
              className="text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:text-brand"
            >
              {dict.footer_terms ?? "Terms & Conditions"}
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
