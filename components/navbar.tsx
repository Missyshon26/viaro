"use client";

import { useState, useRef } from "react";
import { Menu, X, Phone, ChevronDown, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BrandLogo } from "@/components/brand-logo";

interface NavbarProps {
  dict: any;
  /** Resolved on the server in the root layout; the token never reaches the client. */
  auth?: { signedIn: boolean; home: string };
}

export function Navbar({ dict, auth }: NavbarProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [mobileServicesOpen, setMobileServicesOpen] = useState(false);
  const [servicesOpen, setServicesOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pathname = usePathname();

  const base = "";

  const handleMouseEnter = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setServicesOpen(true);
  };

  const handleMouseLeave = () => {
    closeTimer.current = setTimeout(() => setServicesOpen(false), 80);
  };

  const navLinks = [
    { label: dict.navbar.home, href: "/" },
    {
      label: dict.navbar.services,
      href: `${base}/black-car-services`,
      dropdown: [
        { label: dict.navbar.airport,   href: `${base}/black-car-service/airport-transfers` },
        { label: dict.navbar.corporate, href: `${base}/black-car-service/corporate-transportation` },
        { label: dict.navbar.airline,   href: `${base}/black-car-service/fbo-crew-transportation` },
        { label: dict.navbar.cruise,    href: `${base}/black-car-service/cruise-port-transfers` },
        { label: dict.navbar.hourly,    href: `${base}/black-car-service/hourly-chauffeur-hire` },
      ],
    },
    { label: dict.navbar.fleet,     href: `${base}/fleet` },
    { label: dict.navbar.locations, href: `${base}/service-areas` },
    { label: dict.navbar.about,     href: `${base}/about-us` },
    { label: dict.navbar.contact,   href: `${base}/contact` },
  ];

  return (
    <>
      {isOpen && (
        <div
          className="fixed inset-0 z-40 lg:hidden"
          onClick={() => { setIsOpen(false); setMobileServicesOpen(false); }}
          style={{ pointerEvents: mobileServicesOpen ? "none" : "auto" }}
        />
      )}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-black backdrop-blur-md border-b border-border">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-20 items-center justify-between">

          <Link href={"/"} className="flex items-center gap-2" aria-label="Viaro home">
            <BrandLogo height={40} />
          </Link>

          {/* ── Desktop nav ── */}
          <div className="hidden lg:flex items-center gap-8">
            {navLinks.map((link) =>
              link.dropdown ? (
                <div key={link.label} className="relative py-4">
                  <div onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave} className="inline-block">
                    <Link
                      href={link.href}
                      className="flex items-center gap-1 text-sm font-medium uppercase tracking-widest text-muted-foreground transition-colors hover:text-primary"
                    >
                      {link.label}
                      <ChevronDown className={`h-3.5 w-3.5 transition-transform duration-300 ${servicesOpen ? "rotate-180" : ""}`} />
                    </Link>
                  </div>

                  {servicesOpen && (
                    <div
                      onMouseEnter={handleMouseEnter}
                      onMouseLeave={handleMouseLeave}
                      className="absolute top-[calc(100%-0.5rem)] left-1/2 -translate-x-1/2 w-64 bg-neutral-950 border border-white/10 rounded-xl shadow-2xl shadow-black/50 overflow-hidden z-50"
                    >
                      <div className="absolute -top-1.5 left-1/2 -translate-x-1/2 w-3 h-3 bg-neutral-950 border-l border-t border-white/10 rotate-45" />
                      <div className="py-2">
                        {link.dropdown.map((item) => (
                          <Link
                            key={item.href}
                            href={item.href}
                            onClick={() => setServicesOpen(false)}
                            className="flex items-center gap-3 px-4 py-3 text-sm text-muted-foreground hover:text-white hover:bg-white/5 transition-all duration-200 group/item"
                          >
                            <span className="h-px w-4 bg-primary opacity-0 group-hover/item:opacity-100 transition-opacity duration-200 flex-shrink-0" />
                            {item.label}
                          </Link>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <Link
                  key={link.href}
                  href={link.href}
                  className="relative text-sm font-medium uppercase tracking-widest text-muted-foreground transition-colors hover:text-primary after:absolute after:bottom-0 after:left-0 after:h-px after:w-0 after:bg-primary after:transition-all after:duration-300 hover:after:w-full"
                >
                  {link.label}
                </Link>
              ),
            )}
          </div>

          {/* ── Desktop right ── */}
          <div className="hidden lg:flex items-center gap-6">
            <a href="tel:(206)672-8281" className="flex items-center gap-2 text-sm text-muted-foreground">
              <Phone className="h-4 w-4" />
              <span>(206) 672-8281</span>
            </a>

            {auth?.signedIn ? (
              <Link
                href={auth.home}
                className="text-sm uppercase tracking-widest text-muted-foreground transition hover:text-white"
              >
                My account
              </Link>
            ) : (
              <Link
                href="/login"
                className="text-sm uppercase tracking-widest text-muted-foreground transition hover:text-white"
              >
                Sign in
              </Link>
            )}

            {/* Books through our own flow now, not the external legacy system. */}
            <Link href="/book">
              <Button className="bg-primary text-primary-foreground rounded-full hover:bg-primary/90 px-6 uppercase tracking-widest text-xs font-semibold">
                {dict.navbar.book}
              </Button>
            </Link>
          </div>

          {/* ── Mobile toggle ── */}
          <button
            suppressHydrationWarning
            className="lg:hidden flex items-center justify-center h-10 w-10 rounded-full border border-white/10 text-foreground transition hover:border-white/30"
            onClick={() => setIsOpen(!isOpen)}
          >
            {isOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>
      {isOpen && (
        <div className="lg:hidden border-t border-white/10 bg-neutral-950">
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
            <a href="tel:(206)672-8281" className="flex items-center gap-2 text-xs text-white/50 hover:text-white transition-colors">
              <Phone className="h-3.5 w-3.5" />
              (206) 672-8281
            </a>
            <Link
              href={auth?.signedIn ? auth.home : "/login"}
              onClick={() => setIsOpen(false)}
              className="text-xs font-bold uppercase tracking-widest text-white/70 transition-colors hover:text-white"
            >
              {auth?.signedIn ? "My account" : "Sign in"}
            </Link>
          </div>
          <div className="flex flex-col px-4 pt-2 pb-4">
            {navLinks.map((link) =>
              link.dropdown ? (
                <div key={link.label} className="border-b border-white/5">
                  <div className="flex items-center justify-between">
                    <Link
                      href={link.href}
                      onClick={() => setIsOpen(false)}
                      className="flex-1 py-4 text-sm font-semibold uppercase tracking-widest text-white/80 hover:text-primary transition-colors"
                    >
                      {link.label}
                    </Link>
                    <button
                      onClick={() => setMobileServicesOpen(!mobileServicesOpen)}
                      className="flex items-center justify-center h-8 w-8 rounded-full bg-white/5 hover:bg-primary/20 transition-colors ml-2"
                    >
                      <ChevronDown className={`h-4 w-4 text-primary transition-transform duration-300 ${mobileServicesOpen ? "rotate-180" : ""}`} />
                    </button>
                  </div>
                  {mobileServicesOpen && (
                    <div className="flex flex-col gap-1.5 pb-3">
                      {link.dropdown.map((item) => (
                        <Link
                          key={item.href}
                          href={item.href}
                          onClick={() => setIsOpen(false)}
                          className="flex items-center justify-between px-4 py-3 rounded-xl bg-white/5 border border-white/5 text-xs text-white/60 hover:text-white hover:border-primary/30 hover:bg-white/8 transition-all duration-200"
                        >
                          <span>{item.label}</span>
                          <ArrowRight className="h-3 w-3 text-primary flex-shrink-0" />
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={() => setIsOpen(false)}
                  className="py-4 text-sm font-semibold uppercase tracking-widest text-white/80 hover:text-primary transition-colors border-b border-white/5"
                >
                  {link.label}
                </Link>
              ),
            )}
          </div>
          <div className="px-4 pb-6">
            <Link href="/book" onClick={() => setIsOpen(false)} className="block">
              <button className="w-full h-12 rounded-full bg-primary text-black text-xs font-bold uppercase tracking-widest flex items-center justify-center gap-2 hover:bg-primary/90 transition-colors">
                {dict.navbar.book}
                <ArrowRight className="h-4 w-4" />
              </button>
            </Link>
          </div>

        </div>
      )}
      </nav>
    </>
  );
}