"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Check, ChevronDown } from "lucide-react";

interface Option { value: string; label: string }

/** A compact, keyboard-accessible single-choice filter with a themed option list. */
export function FilterSelect({ label, value, options, onChange, showLabel = false }: {
  label: string;
  value: string;
  options: Option[];
  onChange: (value: string) => void;
  showLabel?: boolean;
}) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const search = useRef({ text: "", at: 0 });
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const selected = Math.max(0, options.findIndex((option) => option.value === value));

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  useEffect(() => {
    if (open) document.getElementById(`${id}-option-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [open, active, id]);

  function choose(index: number) {
    if (!options[index]) return;
    onChange(options[index].value);
    setOpen(false);
    trigger.current?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "Tab") { setOpen(false); return; }
    if (event.key === "Escape") { event.preventDefault(); setOpen(false); return; }
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      setOpen(true);
      const base = open ? active : selected;
      setActive(event.key === "Home" ? 0 : event.key === "End" ? options.length - 1 : Math.max(0, Math.min(options.length - 1, base + (event.key === "ArrowDown" ? 1 : -1))));
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (open) choose(active);
      else { setActive(selected); setOpen(true); }
    } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      const now = Date.now();
      search.current = { text: (now - search.current.at > 700 ? "" : search.current.text) + event.key.toLowerCase(), at: now };
      const match = options.findIndex((option) => option.label.toLowerCase().startsWith(search.current.text));
      if (match >= 0) { setActive(match); setOpen(true); }
    }
  }

  return (
    <div ref={root} className="relative min-w-0" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
      <span id={`${id}-label`} className={showLabel ? "mb-2 block text-label font-medium text-fg-muted" : "sr-only"}>{label}</span>
      <button
        ref={trigger}
        type="button"
        role="combobox"
        aria-labelledby={`${id}-label ${id}-value`}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={`${id}-list`}
        aria-activedescendant={open ? `${id}-option-${active}` : undefined}
        onKeyDown={onKeyDown}
        onClick={() => { setActive(selected); setOpen(!open); }}
        className={`flex h-12 w-full items-center gap-3 rounded-field border bg-surface-raised px-4 text-left text-meta text-fg transition-colors hover:border-accent/50 ${open ? "border-accent ring-2 ring-accent/10" : "border-border"}`}
      >
        <span id={`${id}-value`} className="min-w-0 flex-1 truncate">{options[selected]?.label ?? "Select…"}</span>
        <ChevronDown aria-hidden size={16} className={`shrink-0 text-fg-muted transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && <ul id={`${id}-list`} role="listbox" aria-labelledby={`${id}-label`} className="absolute left-0 right-0 top-full z-50 mt-2 max-h-72 overflow-y-auto overscroll-contain rounded-field border border-border bg-surface-raised p-1.5 shadow-[var(--shadow-raised)]">
        {options.map((option, index) => (
          <li
            id={`${id}-option-${index}`}
            key={option.value}
            role="option"
            aria-selected={value === option.value}
            onPointerMove={() => setActive(index)}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => choose(index)}
            className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-meta ${index === active ? "bg-surface" : ""} ${value === option.value ? "font-medium text-accent-strong" : "text-fg-body"}`}
          >
            <span className="min-w-0 flex-1">{option.label}</span>
            {value === option.value && <Check aria-hidden size={15} className="shrink-0 text-accent" />}
          </li>
        ))}
      </ul>}
    </div>
  );
}
