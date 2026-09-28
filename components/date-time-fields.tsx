"use client";

import { useState } from "react";
import { DayPicker } from "react-day-picker";
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, Clock } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/**
 * Date and time pickers that behave the same everywhere.
 *
 * These replaced <input type="date"> and <input type="time">, which the team reported as
 * "doesn't work": on the dark theme the native calendar/clock icons were black on black,
 * desktop Chrome only opens the picker from that invisible icon, and Safari and Firefox
 * each draw something different. A date is now a calendar in a pop-over and a time is
 * a dropdown, both styled in the brand.
 *
 * Values stay in the shapes the forms already used — "yyyy-mm-dd" and "HH:mm" — so no
 * validation or submission code changed.
 */

const pad = (n: number) => String(n).padStart(2, "0");
const toIso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromIso = (value?: string) => {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y, m - 1, d);
};

export function DateField({
  id,
  value,
  onChange,
  className,
  placeholder = "Select a date",
  min,
  name,
}: {
  id: string;
  value: string;
  onChange: (next: string) => void;
  /** Classes for the trigger, so it matches the surrounding inputs. */
  className?: string;
  placeholder?: string;
  /** Earliest selectable day, "yyyy-mm-dd". Defaults to today. */
  min?: string;
  /** When set, the value is also posted with a surrounding <form>. */
  name?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = fromIso(value);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const earliest = fromIso(min) ?? today;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          id={id}
          type="button"
          aria-haspopup="dialog"
          className={cn("flex items-center gap-2 text-left", className)}
        >
          <CalendarDays className="h-4 w-4 shrink-0 text-azure" aria-hidden />
          <span className={cn("min-w-0 flex-1 truncate", !selected && "text-white/40")}>
            {selected
              ? selected.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" })
              : placeholder}
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 opacity-60" aria-hidden />
        </button>
      </PopoverTrigger>
      {name ? <input type="hidden" name={name} value={value} /> : null}
      <PopoverContent align="start" className="w-auto border-border bg-card p-3">
        <DayPicker
          mode="single"
          selected={selected}
          defaultMonth={selected ?? earliest}
          onSelect={(day) => {
            if (!day) return;
            onChange(toIso(day));
            setOpen(false);
          }}
          disabled={{ before: earliest }}
          weekStartsOn={0}
          components={{
            Chevron: ({ orientation }) =>
              orientation === "left" ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />,
          }}
          classNames={{
            root: "relative text-sm text-cloud font-sans",
            months: "flex flex-col",
            month: "space-y-3",
            month_caption: "flex h-8 items-center justify-center font-medium",
            caption_label: "text-sm font-medium",
            nav: "absolute inset-x-0 top-0 flex h-8 items-center justify-between",
            button_previous:
              "flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-white/5 hover:text-cloud disabled:opacity-30",
            button_next:
              "flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-white/5 hover:text-cloud disabled:opacity-30",
            month_grid: "w-full border-collapse",
            weekdays: "flex",
            weekday: "w-9 text-center text-[0.7rem] font-normal uppercase text-muted-foreground",
            week: "mt-1 flex w-full",
            day: "h-9 w-9 p-0 text-center",
            day_button:
              "h-9 w-9 rounded-md transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            selected: "[&>button]:bg-primary [&>button]:text-primary-foreground [&>button]:hover:bg-primary",
            today: "[&>button]:font-semibold [&>button]:text-azure",
            outside: "opacity-40",
            disabled: "opacity-25 [&>button]:cursor-not-allowed [&>button]:hover:bg-transparent",
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

/** Every 15 minutes, as "HH:mm" with a 12-hour label. */
const SLOTS = Array.from({ length: 96 }, (_, i) => {
  const h = Math.floor(i / 4);
  const m = (i % 4) * 15;
  const value = `${pad(h)}:${pad(m)}`;
  const label = new Date(2000, 0, 1, h, m).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
  return { value, label };
});

export function TimeField({
  id,
  value,
  onChange,
  className,
  placeholder = "Select a time",
  name,
}: {
  id: string;
  value: string;
  onChange: (next: string) => void;
  className?: string;
  placeholder?: string;
  name?: string;
}) {
  // A value off the 15-minute grid (e.g. an existing booking at 09:10) stays selectable.
  const options = value && !SLOTS.some((s) => s.value === value)
    ? [...SLOTS, {
        value,
        label: new Date(`2000-01-01T${value}:00`).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }),
      }].sort((a, b) => a.value.localeCompare(b.value))
    : SLOTS;

  return (
    <div className="relative">
      <Clock className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-azure" aria-hidden />
      <select
        id={id}
        name={name}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        // Caller's classes first so the icon padding below wins over their px-*.
        className={cn(className, "appearance-none pl-10 pr-9", !value && "text-white/40")}
      >
        <option value="" disabled>
          {placeholder}
        </option>
        {options.map((slot) => (
          <option key={slot.value} value={slot.value}>
            {slot.label}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 opacity-60" aria-hidden />
    </div>
  );
}
