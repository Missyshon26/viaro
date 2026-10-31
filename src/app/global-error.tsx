"use client";

import { useEffect } from "react";

/**
 * The last safety net: a failure in the page frame itself (the root layout), which app/error.tsx
 * cannot catch because it sits inside that frame. It replaces the whole document, so it brings its
 * own <html> and plain styles — nothing here may depend on the layout, the theme or the stylesheet.
 */
export default function GlobalError({
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
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#f7f5f0",
          color: "#1a1a1a",
          fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif",
        }}
      >
        <main style={{ maxWidth: 440, padding: 32, textAlign: "center" }}>
          <h1 style={{ fontSize: 22, margin: "0 0 12px" }}>Something went wrong</h1>
          <p style={{ margin: "0 0 20px", lineHeight: 1.5, color: "#555" }}>
            The console could not load. Try again, and if it keeps happening, reload the page or sign in again.
          </p>
          {error.digest ? <p style={{ margin: "0 0 20px", fontFamily: "monospace", fontSize: 12, color: "#777" }}>Reference {error.digest}</p> : null}
          <button
            type="button"
            onClick={reset}
            style={{ padding: "10px 20px", borderRadius: 8, border: 0, background: "#b38c00", color: "#fff", fontWeight: 700, cursor: "pointer" }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
