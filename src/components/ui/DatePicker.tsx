"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";

function dateOf(value: string) { return new Date(`${value}T12:00:00`); }
function keyOf(date: Date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; }
const months = Array.from({ length: 12 }, (_, month) => new Date(2026, month, 1).toLocaleString("en-US", { month: "long" }));

export function DatePicker({ label, value, onChange, min, max, invalid = false }: {
  label: string; value: string; onChange: (value: string) => void; min?: string; max?: string; invalid?: boolean;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [focusDay, setFocusDay] = useState("");
  const [month, setMonth] = useState("");
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const allowed = (day: string) => (!min || day >= min) && (!max || day <= max);
  const clamp = (day: string) => min && day < min ? min : max && day > max ? max : day;
  const today = keyOf(new Date());

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!panel.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) setOpen(false);
    };
    const reposition = () => {
      const rect = trigger.current?.getBoundingClientRect();
      if (rect) setPosition({ left: Math.max(8, Math.min(rect.left, window.innerWidth - 312)), top: Math.max(8, Math.min(rect.bottom + 8, window.innerHeight - 390)) });
    };
    reposition();
    document.addEventListener("pointerdown", outside);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => { document.removeEventListener("pointerdown", outside); window.removeEventListener("resize", reposition); window.removeEventListener("scroll", reposition, true); };
  }, [open]);

  useEffect(() => { if (open) panel.current?.querySelector<HTMLButtonElement>(`[data-day="${focusDay}"]`)?.focus({ preventScroll: true }); }, [open, focusDay]);

  function show() {
    const day = clamp(value || today);
    setFocusDay(day); setMonth(day); setOpen(true);
  }
  function choose(day: string) { onChange(day); setOpen(false); trigger.current?.focus(); }
  function moveMonth(delta: number) {
    const date = dateOf(month); date.setDate(1); date.setMonth(date.getMonth() + delta);
    setMonth(keyOf(date));
  }
  function navigate(event: KeyboardEvent<HTMLButtonElement>, day: string) {
    const delta = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[event.key];
    if (delta === undefined && !["Home", "End", "PageUp", "PageDown"].includes(event.key)) return;
    event.preventDefault();
    const date = dateOf(day);
    if (delta !== undefined) date.setDate(date.getDate() + delta);
    else if (event.key === "Home") date.setDate(date.getDate() - date.getDay());
    else if (event.key === "End") date.setDate(date.getDate() + 6 - date.getDay());
    else { date.setDate(1); date.setMonth(date.getMonth() + (event.key === "PageUp" ? -1 : 1)); }
    const next = clamp(keyOf(date)); setMonth(next); setFocusDay(next);
  }
  const first = month ? dateOf(month) : new Date(); first.setDate(1);
  const start = new Date(first); start.setDate(1 - first.getDay());
  const days = Array.from({ length: 42 }, (_, index) => { const day = new Date(start); day.setDate(start.getDate() + index); return day; });

  return <>
    <button ref={trigger} type="button" aria-label={`${label}: ${value || "Choose date"}`} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => open ? setOpen(false) : show()} className={`flex h-11 w-full min-w-[140px] items-center justify-between gap-3 rounded-field border bg-surface-raised px-3 text-meta font-normal ${invalid ? "border-danger" : open ? "border-accent ring-2 ring-accent/10" : "border-border hover:border-accent/50"}`}>
      <span className={value ? "text-fg" : "text-fg-muted"}>{value ? dateOf(value).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "Choose date"}</span><CalendarDays size={16} aria-hidden className="shrink-0 text-accent" />
    </button>
    {open && createPortal(<div ref={panel} id={id} role="dialog" aria-label={`Choose ${label.toLowerCase()}`} style={position} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); setOpen(false); trigger.current?.focus(); } }} className="fixed z-[80] w-[304px] max-w-[calc(100vw-16px)] overflow-hidden rounded-card border border-border bg-surface-raised p-3 text-fg shadow-[var(--shadow-raised)]">
      <div className="mb-3 flex items-center gap-1 border-b border-border-subtle pb-3">
        <button type="button" aria-label="Previous month" onClick={() => moveMonth(-1)} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-fg-muted hover:bg-surface"><ChevronLeft size={17} /></button>
        <div className="flex min-w-0 flex-1 items-center justify-center gap-1">
          <select aria-label="Month" value={first.getMonth()} onChange={(event) => { const next = new Date(first); next.setMonth(Number(event.target.value)); setMonth(keyOf(next)); }} className="min-w-0 rounded-lg bg-surface-raised px-1 text-note font-semibold text-fg">{months.map((name, i) => <option key={name} value={i}>{name}</option>)}</select>
          <input aria-label="Year" type="number" min={1900} max={2100} value={first.getFullYear()} onChange={(event) => { const year = Number(event.target.value); if (year >= 1900 && year <= 2100) { const next = new Date(first); next.setFullYear(year); setMonth(keyOf(next)); } }} className="w-[64px] rounded-lg border border-border bg-surface px-1 py-1 text-center text-note font-semibold" />
        </div>
        <button type="button" aria-label="Next month" onClick={() => moveMonth(1)} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-fg-muted hover:bg-surface"><ChevronRight size={17} /></button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center">{["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((name) => <span key={name} className="py-1 text-[11px] font-medium text-fg-muted">{name}</span>)}
        {days.map((date) => { const day = keyOf(date); return <button key={day} type="button" data-day={day} aria-label={date.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })} aria-pressed={day === value} aria-current={day === today ? "date" : undefined} disabled={!allowed(day)} tabIndex={day === focusDay || (date.getDate() === 1 && !days.some((d) => keyOf(d) === focusDay)) ? 0 : -1} onKeyDown={(event) => navigate(event, day)} onClick={() => choose(day)} className={`flex h-9 items-center justify-center rounded-lg text-note transition-colors disabled:cursor-not-allowed disabled:opacity-25 ${day === value ? "bg-primary font-semibold text-primary-fg" : day === today ? "bg-accent-soft font-semibold text-accent-strong" : date.getMonth() !== first.getMonth() ? "text-fg-faint hover:bg-surface" : "text-fg hover:bg-accent-soft"}`}>{date.getDate()}</button>; })}
      </div>
      <div className="mt-3 flex justify-between border-t border-border-subtle pt-2"><button type="button" onClick={() => choose("")} className="min-h-9 rounded-lg px-3 text-note text-fg-muted hover:bg-surface">Clear</button><button type="button" disabled={!allowed(today)} onClick={() => choose(today)} className="min-h-9 rounded-lg bg-accent-soft px-3 text-note font-semibold text-accent-strong disabled:opacity-40">Today</button></div>
    </div>, document.body)}
  </>;
}
