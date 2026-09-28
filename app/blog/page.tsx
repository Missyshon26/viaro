import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Blog | Viaro",
  description: "News, travel notes and service updates from Viaro.",
};

/**
 * Placeholder. The blog has no backend resource behind it — the API exposes no posts
 * collection — but the footer links here, so this stands in rather than 404ing.
 */
export default function BlogPage() {
  return (
    <main className="bg-black min-h-[70vh]">
      <section className="mx-auto max-w-3xl px-6 py-24 text-center sm:py-32">
        <p className="text-sm uppercase tracking-[0.08em] text-brand">Journal</p>
        <h1 className="mt-4 font-sans text-4xl font-bold text-foreground sm:text-5xl">
          Stories from the road
        </h1>
        <p className="mt-6 text-base leading-relaxed text-muted-foreground">
          We&apos;re putting together travel notes, airport guides and service
          updates. Nothing published yet — check back shortly.
        </p>
        <Link
          href="/"
          className="mt-10 inline-flex h-12 items-center justify-center rounded-lg bg-primary px-8 font-semibold text-primary-foreground transition-opacity hover:opacity-90"
        >
          Back to home
        </Link>
      </section>
    </main>
  );
}
