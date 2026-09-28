/**
 * The Viaro mark, as used in the header and footer.
 *
 * Two problems with dropping public/Logo/Logo.png straight into an <img>:
 *
 *   - The artwork sits in the middle of a 1080×1080 square with wide empty margins, so at
 *     h-12 the mark itself rendered about 20px tall and the wordmark about 6px — the thin
 *     outline strokes all but vanished.
 *   - Its mid blue (#4E98BF) has little contrast against the black header and the
 *     near-black footer, so what did render blended into the background.
 *
 * Here the PNG is used as a mask instead: its alpha channel gives the shape, and the
 * colour is Cloud Leather (#E1EFE6) — the brand manual's light variant of the logo for
 * dark backgrounds ("Color variants" page), which reads clearly on Executive Black.
 * The mask is cropped to the artwork's own bounds (x 30–1050, y 260–820 of the 1080
 * canvas), so the height given is the logo's height.
 */
const ART_WIDTH = 1020;
const ART_HEIGHT = 560;
const CANVAS = 1080;

export function BrandLogo({
  className = "",
  height = 44,
}: {
  className?: string;
  /** Rendered height in px of the mark + wordmark, with no padding. */
  height?: number;
}) {
  const width = Math.round((height * ART_WIDTH) / ART_HEIGHT);
  const size = `${(CANVAS / ART_WIDTH) * 100}% auto`;

  return (
    <span
      role="img"
      aria-label="Viaro"
      className={`inline-block shrink-0 bg-cloud ${className}`}
      style={{
        width,
        height,
        maskImage: "url(/Logo/Logo.png)",
        WebkitMaskImage: "url(/Logo/Logo.png)",
        maskRepeat: "no-repeat",
        WebkitMaskRepeat: "no-repeat",
        // Scale the square canvas so the artwork's width fills the box, then centre it:
        // the empty margins above and below fall outside the box.
        maskSize: size,
        WebkitMaskSize: size,
        maskPosition: "center",
        WebkitMaskPosition: "center",
      }}
    />
  );
}
