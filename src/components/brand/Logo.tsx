import Image from "next/image";

/**
 * The ABL mark (the "ab" monogram), with the colourway that suits the surface: black and
 * gold on a light background, white and gold on a dark one.
 *
 * Mark only, on purpose: the console shows it at 40–80px, where the full logo's lettering
 * would be unreadable.
 */
const RATIO = 1160 / 700;

export function Logo({
  className = "",
  width = 64,
  onDark = false,
}: {
  className?: string;
  width?: number;
  /** The surface behind it is always dark (e.g. the sign-in panel), whatever the theme. */
  onDark?: boolean;
}) {
  const height = Math.round(width / RATIO);
  const common = { alt: "ABL", width: 580, height: 350, priority: true, style: { width: "100%", height: "auto" } } as const;

  return (
    <span className={`block shrink-0 ${className}`} style={{ width, maxWidth: "100%", aspectRatio: `${width} / ${height}` }}>
      <Image src={onDark ? "/abl-mark-dark.png" : "/abl-mark.png"} className={onDark ? "block" : "block dark:hidden"} {...common} />
      {!onDark && <Image src="/abl-mark-dark.png" className="hidden dark:block" {...common} />}
    </span>
  );
}
