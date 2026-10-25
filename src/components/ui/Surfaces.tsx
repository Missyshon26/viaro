import type { ReactNode } from "react";

/**
 * The four surfaces every desktop frame is assembled from.
 *
 * Figma draws them as flat vectors rather than auto-layout, so the geometry here is
 * read off the frames: cards are white on a #D3E1F0 hairline at 14px radius, bands
 * are full-bleed #F5F9FD, and the "panel" surfaces (CTA bands and the undefined-rule
 * callouts) are solid navy with white type.
 */

/** Page gutter. Marketing frames inset content by 50px in a 1280 frame. */
export function Container({
  children,
  className = "",
  width = "wide",
}: {
  children: ReactNode;
  className?: string;
  /** Booking steps use a narrower 1100px measure than the marketing pages. */
  width?: "wide" | "narrow";
}) {
  const max = width === "wide" ? "max-w-[1180px]" : "max-w-[1100px]";
  return (
    <div className={`mx-auto w-full ${max} px-5 md:px-8 lg:px-0 ${className}`}>{children}</div>
  );
}

/** A tinted full-bleed strip. Alternating bands are what give the page its rhythm. */
export function Band({
  children,
  tinted = true,
  width = "wide",
  className = "",
  id,
}: {
  children: ReactNode;
  tinted?: boolean;
  /** Home lays out on a 1180 measure; the sub-pages and booking steps use 1100. */
  width?: "wide" | "narrow";
  className?: string;
  id?: string;
}) {
  return (
    <section
      id={id}
      className={`w-full py-12 lg:py-16 ${tinted ? "bg-surface" : "bg-bg"} ${className}`}
    >
      <Container width={width}>{children}</Container>
    </section>
  );
}

/** The tinted intro strip at the top of Services, Fleet and About. */
export function PageHero({
  eyebrow,
  title,
  intro,
  children,
}: {
  eyebrow: string;
  title: ReactNode;
  intro: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section className="w-full bg-surface py-12 lg:py-16">
      <Container width="narrow">
        <div className="mx-auto max-w-[52rem]">
          <p className="text-label font-bold text-accent-strong">{eyebrow}</p>
          <h1 className="mt-4 text-[2.25rem] font-bold leading-[1.1] tracking-tight text-fg sm:text-[2.75rem] lg:text-hero">
            {title}
          </h1>
          <p className="mt-5 max-w-[34rem] text-body leading-relaxed text-fg-body lg:text-lead">
            {intro}
          </p>
          {children}
        </div>
      </Container>
    </section>
  );
}

export function Card({
  children,
  className = "",
  as: Tag = "div",
  id,
}: {
  children: ReactNode;
  className?: string;
  as?: "div" | "article" | "li";
  id?: string;
}) {
  return (
    <Tag id={id} className={`rounded-card border border-border bg-surface-raised ${className}`}>
      {children}
    </Tag>
  );
}

/** Small caps-ish label above a section. Figma: 10.5px bold, muted. */
export function Kicker({ children }: { children: ReactNode }) {
  return <p className="text-micro font-bold text-fg-muted">{children}</p>;
}

/** Band heading + optional intro, with an optional action pinned right. */
export function SectionHeading({
  title,
  intro,
  action,
  className = "",
}: {
  title: string;
  intro?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex flex-col gap-4 sm:flex-row sm:items-end ${className}`}>
      <div className="max-w-[42rem]">
        <h2 className="text-display font-bold tracking-tight text-fg lg:text-heading">
          {title}
        </h2>
        {intro && <p className="mt-3 text-body leading-relaxed text-fg-body">{intro}</p>}
      </div>
      {action && <div className="sm:ml-auto sm:shrink-0">{action}</div>}
    </div>
  );
}

/** The pale blue pill used for "24 h free cancel", "Selected", "Requested". */
export function Badge({
  children,
  tone = "soft",
}: {
  children: ReactNode;
  tone?: "soft" | "panel";
}) {
  const tones = {
    soft: "bg-accent-soft text-accent-strong",
    panel: "bg-panel text-panel-fg",
  };
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-label font-bold ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

/**
 * The navy callout the design uses wherever a business rule is genuinely undecided.
 * It is deliberately loud: the designer's note is that the page must say "undefined"
 * rather than invent a policy.
 */
export function WarnBox({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-card bg-panel px-5 py-4 text-panel-fg">
      <p className="text-small font-bold">{title}</p>
      <p className="mt-2 max-w-[62rem] text-small leading-relaxed text-panel-muted">
        {children}
      </p>
    </div>
  );
}

/** A number over a caption — the hero trio and the metrics strip. */
export function Stat({
  value,
  label,
  size = "sm",
}: {
  value: string;
  label: string;
  size?: "sm" | "lg";
}) {
  return (
    <div>
      <p
        className={`font-bold tracking-tight text-fg ${
          size === "lg" ? "text-stat lg:text-metric" : "text-stat"
        }`}
      >
        {value}
      </p>
      <p className="mt-1 text-note text-fg-muted">{label}</p>
    </div>
  );
}

/** Blue tick + line of copy, repeated down every service card. */
export function CheckLine({ children }: { children: ReactNode }) {
  return (
    <li className="flex gap-2.5 text-meta text-fg">
      <span aria-hidden className="font-bold text-accent">
        ✓
      </span>
      <span>{children}</span>
    </li>
  );
}
