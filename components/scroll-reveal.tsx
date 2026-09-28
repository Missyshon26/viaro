"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { isAppRoute } from "@/components/site-chrome";

/**
 * Scroll-reveal animation, applied without fighting hydration.
 *
 * The previous version ran its `querySelectorAll` pass on a 120 ms timer and added a
 * `.reveal` class to nearly every element on the page. With streamed RSC content that
 * timer regularly fired while React was still hydrating, so React found DOM nodes
 * carrying classes its own render did not produce — a hydration mismatch logged on every
 * fresh page load, on every page. It also injected its stylesheet with
 * `document.createElement("style")` at runtime, which is more markup React does not know
 * about.
 *
 * Two changes fix it:
 *   - the CSS lives in globals.css, so no style element is created at runtime;
 *   - the DOM pass is deferred until the page has loaded and the browser is idle, so
 *     streamed sections have hydrated before any className changes (see below).
 *
 * `prefers-reduced-motion` is honoured by skipping the effect entirely — the content is
 * then simply visible, which is the correct reduced-motion behaviour.
 */

declare global {
  interface Window {
    __scrollRevealObserver?: IntersectionObserver;
  }
}

const REVEAL_SELECTOR =
  "section, h1, h2, h3, p, img, a:not(.fixed), button, li, [data-reveal]";

export function ScrollReveal() {
  const pathname = usePathname();

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    // The signed-in product is a tool, not a brochure: tables, forms and buttons that
    // fade in as you scroll only slow it down. (It also raced hydration on streamed
    // account pages, which logged a mismatch.)
    if (isAppRoute(pathname) || document.querySelector("[data-app-shell]")) {
      window.__scrollRevealObserver?.disconnect();
      document.querySelectorAll(".reveal, .visible").forEach((el) => el.classList.remove("reveal", "visible"));
      return;
    }

    window.__scrollRevealObserver?.disconnect();

    let observer: IntersectionObserver | undefined;

    /*
     * Wait until the page has finished loading AND the browser is idle before touching
     * any className. Double-RAF alone was not enough: with streamed RSC, sections below
     * the fold hydrate after this effect runs, and a `.reveal` added to them first made
     * React log a hydration mismatch on every fresh load of the homepage.
     */
    let idle = 0;
    const run = () => {
      document.querySelectorAll(".reveal, .visible").forEach((el) => {
        el.classList.remove("reveal", "visible");
      });

      const elements = Array.from(
        document.querySelectorAll<Element>(REVEAL_SELECTOR),
      );
      elements.forEach((el) => el.classList.add("reveal"));

      observer = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (!entry.isIntersecting) return;
            entry.target.classList.add("visible");
            observer?.unobserve(entry.target);
          });
        },
        { threshold: 0.08, rootMargin: "0px 0px -40px 0px" },
      );

      elements.forEach((el) => observer?.observe(el));
      window.__scrollRevealObserver = observer;
    };
    // Safari has no requestIdleCallback; a short timeout after load is close enough there.
    const hasIdle = typeof window.requestIdleCallback === "function";
    const schedule = () => {
      idle = hasIdle
        ? window.requestIdleCallback(run, { timeout: 1200 })
        : (setTimeout(run, 300) as unknown as number);
    };
    if (document.readyState === "complete") schedule();
    else window.addEventListener("load", schedule, { once: true });

    return () => {
      window.removeEventListener("load", schedule);
      if (hasIdle) window.cancelIdleCallback(idle);
      else clearTimeout(idle);
      observer?.disconnect();
      window.__scrollRevealObserver = undefined;
    };
  }, [pathname]);

  return null;
}
