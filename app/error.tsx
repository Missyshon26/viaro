"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

/** Root error boundary. Keeps the black/brand palette so a failure still looks like Viaro. */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="flex min-h-[70vh] items-center justify-center bg-black px-6">
      <div className="max-w-md text-center">
        <p className="text-sm uppercase tracking-[0.08em] text-brand">Something broke</p>
        <h1 className="mt-4 font-sans text-3xl font-bold text-foreground">
          That did not go to plan
        </h1>
        <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
          {error.message || "An unexpected error occurred."}
        </p>
        {error.digest ? (
          <p className="mt-2 font-mono text-xs text-muted-foreground">
            Reference {error.digest}
          </p>
        ) : null}
        <div className="mt-8 flex justify-center gap-3">
          <Button onClick={reset}>Try again</Button>
          <Button asChild variant="outline">
            {/* next/link, not a bare anchor: an <a> forces a full document reload. */}
            <Link href="/">Back to home</Link>
          </Button>
        </div>
      </div>
    </main>
  );
}
