"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Surfaces";

/** Catches a render failure without losing the shell around it. */
export default function ErrorBoundary({
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
    <div className="mx-auto max-w-[40rem] py-16">
      <Card className="p-8 text-center">
        <h1 className="text-card font-bold text-fg">We could not load this page</h1>
        <p className="mt-3 text-note leading-relaxed text-fg-muted">
          {/* Usually the API being unreachable, or a session that expired mid-request. */}
          {error.message || "The service did not respond."}
        </p>
        {error.digest ? (
          <p className="mt-2 font-mono text-label text-fg-muted">
            Reference {error.digest}
          </p>
        ) : null}
        <div className="mt-6 flex justify-center gap-3">
          <Button variant="accent" block={false} onClick={reset}>
            Try again
          </Button>
        </div>
      </Card>
    </div>
  );
}
