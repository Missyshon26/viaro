import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { Navbar } from "@/components/navbar";
import { Footer } from "@/components/footer";
import { getDictionary } from "@/lib/get-dictionary";
import { readTokens } from "@/lib/auth/session";
import { ScrollReveal } from "@/components/scroll-reveal";
import { QuoteButton } from "@/components/quote-button";
import { RatingGate } from "@/components/app/rating-gate";
import { SiteChrome } from "@/components/site-chrome";
import { getCurrentUser } from "@/lib/auth/current-user";
import "./globals.css";
import { Suspense } from "react";

/**
 * Brand typeface: Clash Display, per the Viaro brand manual ("Viaro, Manual de Marca",
 * Typography page — Extra Light through Bold). It is the only face the manual names, so
 * it sets headings and body alike.
 *
 * Self-hosted from public/fonts (variable, 200–700). Licensed under the ITF Free Font
 * License, which permits commercial use and self-hosting — see
 * public/fonts/ClashDisplay-LICENSE.txt.
 *
 * This replaced Archivo (sans) and Playfair Display (serif), stand-ins that were never in
 * the brand; the serif is what the "What happened to the font chosen?" feedback showed.
 * `font-sans` and `font-serif` both resolve to this face, so the ~70 elements tagged
 * `font-serif` needed no edits.
 */
const brandFont = localFont({
  src: "../public/fonts/ClashDisplay-Variable.woff2",
  weight: "200 700",
  style: "normal",
  display: "swap",
  variable: "--font-brand",
  fallback: ["Helvetica Neue", "Arial", "sans-serif"],
});

export const metadata: Metadata = {
  title: "Viaro",
  description: "Premium executive and luxury transportation service.",
};

export const viewport: Viewport = {
  themeColor: "#060606",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
    const dict = (await getDictionary()) as any;

  /**
   * Read on the server so the navbar can show the right links without any token
   * reaching the browser. The role cookie is readable and is used for routing only.
   */
  const { accessToken, refreshToken, role } = await readTokens();
  const auth = {
    signedIn: Boolean(accessToken || refreshToken),
    // Non-passenger roles are handed off at /portal; they have no home on this site.
    // A passenger lands on their trips — Profile is settings, and comes last.
    home: role === "customer" ? "/trips" : "/portal",
  };
  // Only fetched for signed-in customers, and cached for the rest of this render.
  const user = auth.signedIn && role === "customer" ? await getCurrentUser() : null;
  return (
    <html lang="en" className="scroll-smooth">
      <body className={`${brandFont.variable} font-sans antialiased`}>
        <ScrollReveal />
        <SiteChrome
          signedIn={auth.signedIn && role === "customer"}
          userName={user?.name}
          navbar={<Navbar key="navbar" dict={dict} auth={auth} />}
          footer={<Footer key="footer" dict={dict.footer} />}
          marketingExtras={
            <Suspense key="quote-button" fallback={null}>
              <QuoteButton label={dict.cta_button || "Get Quote"} />
            </Suspense>
          }
        >
          {children}
        </SiteChrome>

        {/* Asks for a rating on any page once a trip is finished. Renders nothing for
            signed-out visitors, and nothing when there is no unrated trip. */}
        <Suspense fallback={null}>
          <RatingGate />
        </Suspense>
      </body>
    </html>
  );
}
