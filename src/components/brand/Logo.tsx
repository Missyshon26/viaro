import Image from "next/image";

/**
 * The VIARO lockup — the isometric mark over the wordmark.
 *
 * The supplied artwork (`public/logo.png`) is RGB on solid black with no alpha, so it
 * would render as a black box on the white palette-B pages. Two trimmed, transparent
 * variants are derived from it, identical except for the wordmark:
 *
 *   viaro-logo-v2.png       Midnight Route mark, Executive Black wordmark — light surfaces
 *   viaro-logo-v2-dark.png  Azure Drive mark, Cloud Leather wordmark      — dark surfaces
 *
 * Colours per the brand manual's "Color variants" page.
 *
 * Both are swapped with CSS rather than JS: reading the theme in a hook would render
 * one frame with the wrong file. `onDark` forces the dark variant for the places that
 * are dark in *both* themes — the navy CTA bands and the auth brand panel.
 *
 * The wrapper is `block`, not `inline-block`: auto margins do not resolve on an
 * inline-level box, so `className="mx-auto"` would silently fail to centre it.
 */
const RATIO = 257 / 440;

export function Logo({
  className = "",
  width = 92,
  onDark = false,
}: {
  className?: string;
  width?: number;
  /** For surfaces that are dark regardless of theme. */
  onDark?: boolean;
}) {
  const height = Math.round(width * RATIO);

  if (onDark) {
    return (
      <Image
        src="/viaro-logo-v2-dark.png"
        alt="VIARO"
        width={width}
        height={height}
        priority
        className={`block ${className}`}
      />
    );
  }

  return (
    <span className={`block ${className}`} style={{ width, height }}>
      <Image
        src="/viaro-logo-v2.png"
        alt="VIARO"
        width={width}
        height={height}
        priority
        className="block dark:hidden"
      />
      <Image
        src="/viaro-logo-v2-dark.png"
        alt=""
        aria-hidden
        width={width}
        height={height}
        priority
        className="hidden dark:block"
      />
    </span>
  );
}
