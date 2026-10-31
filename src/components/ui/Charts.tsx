"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

/**
 * Charts.
 *
 * Drawn as plain SVG rather than with a charting library — the console ships with no
 * runtime dependencies and these four shapes do not justify adding one. They are all
 * built the same way: a viewBox in abstract units with `preserveAspectRatio="none"`
 * off, sized by CSS, so they scale with their container at any breakpoint.
 *
 * Colours come from the --chart-* tokens, which means both themes are handled by the
 * stylesheet rather than by branching in here.
 */

export interface Point {
  /** Bucket label, already formatted for display. */
  label: string;
  value: number;
}

const NUMBER = new Intl.NumberFormat("en-US");
const MONEY = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

export const formatValue = (n: number, kind: "number" | "money" = "number") =>
  kind === "money" ? MONEY.format(n) : NUMBER.format(n);


/* ---------------------------------- y axis --------------------------------- */

const COMPACT = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

/** Short axis labels: 1.2K, 3M, $1.5K — the full value is in the tooltip. */
const axisLabel = (n: number, kind: "number" | "money") => (kind === "money" ? `$${COMPACT.format(n)}` : COMPACT.format(n));

/**
 * The top of the axis, rounded up to a step that reads cleanly (1, 2, 5, 10, 20, 50…) so the four
 * gridlines fall on whole, sensible values — 0, 25, 50, 75, 100 rather than 0, 31.5, 63, 94.5, 126.
 */
export function niceMax(max: number, kind: "number" | "money" = "number"): number {
  if (max <= 0) return 4;
  const raw = Math.max(max / 4, 1);
  const power = 10 ** Math.floor(Math.log10(raw));
  // Counts and whole dollars: every gridline is a whole number, never "2.5 trips".
  const step =
    [1, 2, 2.5, 5, 10]
      .map((m) => m * power)
      .filter((candidate) => Number.isInteger(candidate))
      .find((candidate) => candidate >= raw) ?? Math.ceil(raw);
  return step * 4;
}

/** The chart's pixel width, kept up to date as its container resizes. */
function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth || 600);
    const observer = new ResizeObserver(() => setWidth(el.clientWidth || 600));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

/** Width of the column the value labels sit in. */
const AXIS_GUTTER = 44;

/**
 * The value labels beside the gridlines. The chart is an SVG scaled to fit its box (aspect
 * ratio kept), so each label is placed by the same scale the SVG is drawn with — otherwise a
 * label drifts off its line whenever the box is not exactly the viewBox's shape.
 */
function YAxis({
  top,
  kind,
  width,
  height,
  box,
  pad,
}: {
  top: number;
  kind: "number" | "money";
  width: number;
  height: number;
  box: { W: number; H: number };
  pad: { t: number; innerH: number };
}) {
  const scale = Math.min(width / box.W, height / box.H);
  const offsetY = (height - box.H * scale) / 2;
  return (
    <div aria-hidden className="relative shrink-0" style={{ width: AXIS_GUTTER, height }}>
      {[0, 0.25, 0.5, 0.75, 1].map((t) => (
        <span
          key={t}
          className="absolute right-2 -translate-y-1/2 text-label leading-none text-fg-muted"
          style={{ top: offsetY + (pad.t + pad.innerH * t) * scale }}
        >
          {axisLabel(top * (1 - t), kind)}
        </span>
      ))}
    </div>
  );
}

/** Shared "there is nothing to draw" panel, so every chart fails the same way. */
export function ChartEmpty({ message = "No data for this period", action }: { message?: string; action?: ReactNode }) {
  return (
    <div className="flex h-full min-h-[180px] flex-col items-center justify-center gap-3 rounded-field border border-dashed border-border px-6 py-10 text-center">
      <p className="text-note text-fg-muted">{message}</p>
      {action}
    </div>
  );
}

/** Matching skeleton, so a loading chart occupies the height it will end up at. */
export function ChartSkeleton({ height = 200 }: { height?: number }) {
  return (
    <div
      className="animate-pulse rounded-field bg-surface"
      style={{ height }}
      aria-hidden
    />
  );
}

/* ------------------------------- area / line ------------------------------- */

/**
 * Trend over time. An area rather than a bare line because these series are counts and
 * money — quantities where the filled mass carries meaning.
 */
export function AreaChart({
  data,
  height = 220,
  kind = "number",
  color = "var(--chart-1)",
  emptyAction,
}: {
  data: Point[];
  height?: number;
  kind?: "number" | "money";
  color?: string;
  /** Offered under the "no data" message, so an empty chart says what to do next. */
  emptyAction?: ReactNode;
}) {
  const gradientId = useId();
  const [hover, setHover] = useState<number | null>(null);
  const [boxRef, boxWidth] = useWidth();

  if (data.length === 0) return <ChartEmpty action={emptyAction} />;

  const W = 600;
  const H = 200;
  const PAD_L = 8;
  const PAD_R = 8;
  const PAD_T = 12;
  const PAD_B = 24;

  const max = niceMax(Math.max(...data.map((d) => d.value), 1), kind);
  const innerW = W - PAD_L - PAD_R;
  const innerH = H - PAD_T - PAD_B;

  // A single point has no width to spread over, so pin it to the middle.
  const x = (i: number) =>
    data.length === 1 ? PAD_L + innerW / 2 : PAD_L + (i / (data.length - 1)) * innerW;
  const y = (v: number) => PAD_T + innerH - (v / max) * innerH;

  const line = data.map((d, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(d.value)}`).join(" ");
  const area = `${line} L${x(data.length - 1)},${PAD_T + innerH} L${x(0)},${PAD_T + innerH} Z`;

  const active = hover === null ? null : data[hover];

  return (
    <div className="relative">
      <div className="flex">
        <YAxis top={max} kind={kind} width={boxWidth} height={height} box={{ W, H }} pad={{ t: PAD_T, innerH }} />
        <div ref={boxRef} className="min-w-0 flex-1">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        style={{ height }}
        role="img"
        aria-label={`Trend from ${data[0].label} to ${data[data.length - 1].label}`}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.22" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Four gridlines is enough to read a value against without becoming a grid. */}
        {[0, 0.25, 0.5, 0.75, 1].map((t) => (
          <line
            key={t}
            x1={PAD_L}
            x2={W - PAD_R}
            y1={PAD_T + innerH * t}
            y2={PAD_T + innerH * t}
            stroke="var(--chart-grid)"
            strokeWidth={1}
          />
        ))}

        <path d={area} fill={`url(#${gradientId})`} />
        <path
          d={line}
          fill="none"
          stroke={color}
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />

        {hover !== null ? (
          <>
            <line
              x1={x(hover)}
              x2={x(hover)}
              y1={PAD_T}
              y2={PAD_T + innerH}
              stroke={color}
              strokeWidth={1}
              strokeDasharray="3 3"
            />
            <circle
              cx={x(hover)}
              cy={y(data[hover].value)}
              r={4}
              fill="var(--surface-raised)"
              stroke={color}
              strokeWidth={2}
            />
          </>
        ) : null}

        {/* Invisible hit targets: one column per bucket, so hovering anywhere in the
            column selects it rather than requiring the pointer to find the line. */}
        {data.map((d, i) => (
          <rect
            key={d.label + i}
            x={data.length === 1 ? PAD_L : x(i) - innerW / data.length / 2}
            y={PAD_T}
            width={data.length === 1 ? innerW : innerW / data.length}
            height={innerH}
            fill="transparent"
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          />
        ))}
      </svg>
        </div>
      </div>

      <div className="mt-1 flex justify-between text-label text-fg-muted" style={{ marginLeft: AXIS_GUTTER }}>
        <span>{data[0].label}</span>
        {data.length > 2 ? <span>{data[Math.floor(data.length / 2)].label}</span> : null}
        {data.length > 1 ? <span>{data[data.length - 1].label}</span> : null}
      </div>

      {active ? (
        <div className="pointer-events-none absolute left-0 top-0 rounded-field border border-border bg-surface-raised px-3 py-2 shadow-[var(--shadow-raised)]">
          <p className="text-label text-fg-muted">{active.label}</p>
          <p className="text-action font-bold text-fg">{formatValue(active.value, kind)}</p>
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------ bar ---------------------------------- */

/** Comparison across buckets. Same axis treatment as the area chart. */
export function BarChart({
  data,
  height = 220,
  kind = "number",
  color = "var(--chart-2)",
  emptyAction,
}: {
  data: Point[];
  height?: number;
  kind?: "number" | "money";
  color?: string;
  emptyAction?: ReactNode;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const [boxRef, boxWidth] = useWidth();
  if (data.length === 0) return <ChartEmpty action={emptyAction} />;

  const W = 600;
  const H = 200;
  const PAD = { l: 8, r: 8, t: 12, b: 24 };
  const max = niceMax(Math.max(...data.map((d) => d.value), 1), kind);
  const innerW = W - PAD.l - PAD.r;
  const innerH = H - PAD.t - PAD.b;
  const slot = innerW / data.length;
  const barW = Math.min(slot * 0.62, 46);

  const active = hover === null ? null : data[hover];

  return (
    <div className="relative">
      <div className="flex">
        <YAxis top={max} kind={kind} width={boxWidth} height={height} box={{ W, H }} pad={{ t: PAD.t, innerH }} />
        <div ref={boxRef} className="min-w-0 flex-1">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height }} role="img">
        {[0, 0.25, 0.5, 0.75, 1].map((t) => (
          <line
            key={t}
            x1={PAD.l}
            x2={W - PAD.r}
            y1={PAD.t + innerH * t}
            y2={PAD.t + innerH * t}
            stroke="var(--chart-grid)"
            strokeWidth={1}
          />
        ))}

        {data.map((d, i) => {
          const h = (d.value / max) * innerH;
          const cx = PAD.l + slot * i + slot / 2;
          return (
            <g
              key={d.label + i}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            >
              <rect
                x={PAD.l + slot * i}
                y={PAD.t}
                width={slot}
                height={innerH}
                fill="transparent"
              />
              <rect
                x={cx - barW / 2}
                y={PAD.t + innerH - h}
                width={barW}
                height={Math.max(h, d.value > 0 ? 2 : 0)}
                rx={3}
                fill={color}
                opacity={hover === null || hover === i ? 1 : 0.45}
                className="transition-opacity"
              />
            </g>
          );
        })}
      </svg>
        </div>
      </div>

      <div className="mt-1 flex justify-between text-label text-fg-muted" style={{ marginLeft: AXIS_GUTTER }}>
        <span>{data[0].label}</span>
        {data.length > 2 ? <span>{data[Math.floor(data.length / 2)].label}</span> : null}
        {data.length > 1 ? <span>{data[data.length - 1].label}</span> : null}
      </div>

      {active ? (
        <div className="pointer-events-none absolute left-0 top-0 rounded-field border border-border bg-surface-raised px-3 py-2 shadow-[var(--shadow-raised)]">
          <p className="text-label text-fg-muted">{active.label}</p>
          <p className="text-action font-bold text-fg">{formatValue(active.value, kind)}</p>
        </div>
      ) : null}
    </div>
  );
}

/* ----------------------------------- donut --------------------------------- */

export interface Slice {
  label: string;
  value: number;
  color: string;
}

/**
 * Status distribution. A donut rather than a pie so the total can live in the hole,
 * which is the number people actually want next to the split.
 */
export function DonutChart({
  slices,
  total,
  totalLabel = "Total",
  size = 168,
}: {
  slices: Slice[];
  total?: number;
  totalLabel?: string;
  size?: number;
}) {
  const sum = slices.reduce((acc, s) => acc + s.value, 0);
  if (sum === 0) return <ChartEmpty message="Nothing recorded yet" />;

  const R = 60;
  const C = 2 * Math.PI * R;

  /*
   * Offsets are precomputed rather than accumulated inside the map.
   *
   * The old version reassigned an outer `running` while rendering. That is only safe
   * while every segment is drawn in one uninterrupted pass — exactly the pattern React
   * Compiler memoizes per item, at which point a stale accumulator draws the segments on
   * top of each other with no error to explain it. The reduce carries the running total
   * in its own accumulator, so nothing outside the computation is written to.
   */
  const arcs = slices.reduce<{ slice: (typeof slices)[number]; len: number; offset: number }[]>(
    (acc, s) => {
      const len = (s.value / sum) * C;
      const previous = acc[acc.length - 1];
      const offset = previous ? previous.offset + previous.len : 0;
      acc.push({ slice: s, len, offset });
      return acc;
    },
    [],
  );

  return (
    <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-center sm:gap-7">
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg viewBox="0 0 160 160" className="h-full w-full -rotate-90">
          <circle
            cx="80"
            cy="80"
            r={R}
            fill="none"
            stroke="var(--chart-grid)"
            strokeWidth={18}
          />
          {arcs.map(({ slice: s, len, offset }) => (
            <circle
              key={s.label}
              cx="80"
              cy="80"
              r={R}
              fill="none"
              stroke={s.color}
              strokeWidth={18}
              strokeDasharray={`${len} ${C - len}`}
              strokeDashoffset={-offset}
              strokeLinecap="butt"
            />
          ))}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-[1.5rem] font-bold tracking-tight text-fg">
            {NUMBER.format(total ?? sum)}
          </span>
          <span className="text-label text-fg-muted">{totalLabel}</span>
        </div>
      </div>

      <ul className="w-full min-w-0 space-y-2.5">
        {slices.map((s) => (
          <li key={s.label} className="flex items-center gap-2.5">
            <span
              aria-hidden
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ background: s.color }}
            />
            <span className="min-w-0 truncate text-note text-fg-body">{s.label}</span>
            <span className="ml-auto shrink-0 text-note font-bold text-fg">
              {NUMBER.format(s.value)}
            </span>
            <span className="w-10 shrink-0 text-right text-label text-fg-muted">
              {Math.round((s.value / sum) * 100)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* --------------------------------- progress -------------------------------- */

/** Completion and rate figures — a bar reads a percentage faster than a number. */
export function ProgressBar({
  label,
  value,
  max = 100,
  display,
  tone = "accent",
}: {
  label: string;
  value: number;
  max?: number;
  display?: string;
  tone?: "accent" | "good" | "warn" | "bad";
}) {
  const pct = max === 0 ? 0 : Math.min(100, Math.max(0, (value / max) * 100));
  const colors = {
    accent: "var(--chart-1)",
    good: "var(--chart-good)",
    warn: "var(--chart-warn)",
    bad: "var(--chart-bad)",
  };
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-note text-fg-body">{label}</span>
        <span className="text-note font-bold text-fg">
          {display ?? `${Math.round(pct)}%`}
        </span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface">
        <div
          className="h-full rounded-full transition-[width] duration-500"
          style={{ width: `${pct}%`, background: colors[tone] }}
        />
      </div>
    </div>
  );
}

/* -------------------------------- bucketing -------------------------------- */

/**
 * Rolls timestamped rows into evenly spaced buckets.
 *
 * Buckets are generated from the range rather than from the data, so a quiet day still
 * appears as a zero instead of collapsing the axis — a chart that silently skips empty
 * periods misrepresents the trend.
 */
export function bucketByDay(
  rows: { at: string | null | undefined; value: number }[],
  days: number,
): Point[] {
  const buckets = new Map<string, number>();
  const now = new Date();

  const step = days <= 31 ? "day" : days <= 120 ? "week" : "month";
  const keyOf = (d: Date) => {
    if (step === "month") return `${d.getFullYear()}-${d.getMonth()}`;
    if (step === "week") {
      const monday = new Date(d);
      monday.setDate(d.getDate() - ((d.getDay() + 6) % 7));
      return `${monday.getFullYear()}-${monday.getMonth()}-${monday.getDate()}`;
    }
    return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  };
  const labelOf = (d: Date) =>
    step === "month"
      ? d.toLocaleDateString("en-US", { month: "short" })
      : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });

  const order: { key: string; label: string }[] = [];
  const count = step === "month" ? Math.round(days / 30) : step === "week" ? Math.ceil(days / 7) : days;

  for (let i = count - 1; i >= 0; i -= 1) {
    const d = new Date(now);
    if (step === "month") d.setMonth(now.getMonth() - i);
    else if (step === "week") d.setDate(now.getDate() - i * 7);
    else d.setDate(now.getDate() - i);
    const key = keyOf(d);
    if (!buckets.has(key)) {
      buckets.set(key, 0);
      order.push({ key, label: labelOf(d) });
    }
  }

  for (const row of rows) {
    if (!row.at) continue;
    const d = new Date(row.at);
    if (Number.isNaN(d.getTime())) continue;
    const key = keyOf(d);
    if (buckets.has(key)) buckets.set(key, (buckets.get(key) ?? 0) + row.value);
  }

  return order.map(({ key, label }) => ({ label, value: buckets.get(key) ?? 0 }));
}

/** Range selector shared by every chart card that has one. */
export const RANGES = [
  { key: "7d", label: "7 days", days: 7 },
  { key: "30d", label: "30 days", days: 30 },
  { key: "3m", label: "3 months", days: 90 },
  { key: "12m", label: "12 months", days: 365 },
] as const;

export type RangeKey = (typeof RANGES)[number]["key"];

export function RangeTabs({
  value,
  onChange,
  options = RANGES,
}: {
  value: string;
  onChange: (key: never) => void;
  options?: readonly { key: string; label: string }[];
}) {
  return (
    <div
      role="group"
      aria-label="Reporting period"
      className="inline-flex shrink-0 rounded-field border border-border bg-surface p-0.5"
    >
      {options.map((option) => (
        <button
          key={option.key}
          type="button"
          aria-pressed={value === option.key}
          onClick={() => onChange(option.key as never)}
          className={`min-h-10 rounded-[0.55rem] px-3 py-2 text-label font-bold transition-colors ${
            value === option.key
              ? "bg-surface-raised text-fg shadow-[var(--shadow-card)]"
              : "text-fg-muted hover:text-fg"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** Wrapper giving every chart the same header, spacing and states. */
export function ChartCard({
  title,
  subtitle,
  action,
  loading,
  error,
  onRetry,
  children,
  className = "",
}: {
  title: string;
  subtitle?: ReactNode;
  action?: ReactNode;
  loading?: boolean;
  error?: boolean;
  onRetry?: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-card border border-border bg-surface-raised p-5 shadow-[var(--shadow-card)] ${className}`}
    >
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0">
          <h2 className="text-action font-bold tracking-tight text-fg">{title}</h2>
          {subtitle && !error ? (
            <p className="mt-1 text-note text-fg-muted">{subtitle}</p>
          ) : null}
        </div>
        {action ? <div className="ml-auto">{action}</div> : null}
      </div>
      <div className="mt-5">{loading ? <ChartSkeleton /> : error ? <div role="alert" className="rounded-field bg-surface p-6 text-center"><p className="text-note text-fg-muted">This report could not be loaded.</p>{onRetry ? <button type="button" onClick={onRetry} className="mt-3 min-h-11 rounded-field border border-border px-4 text-note font-bold text-accent">Try again</button> : null}</div> : children}</div>
    </section>
  );
}

/** Convenience for series that are already `{label,value}` but need a running total. */
export function useSeriesTotal(points: Point[]) {
  return useMemo(() => points.reduce((acc, p) => acc + p.value, 0), [points]);
}
