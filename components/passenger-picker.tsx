"use client";

import { useState } from "react";

/**
 * Passenger count: a dropdown for the common 1–8, and "Other (9+)" for anything larger,
 * which opens a number field for the exact count. The dropdown used to stop at 8, so a
 * group of 12 had no way to say so.
 *
 * Emits a plain number either way, so callers never see the "other" sentinel.
 */
const PRESETS = [1, 2, 3, 4, 5, 6, 7, 8];
const OTHER = "other";
const MIN_OTHER = 9;
const MAX_OTHER = 99;

export function PassengerPicker({
  id,
  value,
  onChange,
  className,
  singular = "passenger",
  plural = "passengers",
}: {
  id: string;
  value: number;
  onChange: (next: number) => void;
  className?: string;
  singular?: string;
  plural?: string;
}) {
  // "Other" stays chosen while its box is being edited, even through an empty field.
  const [custom, setCustom] = useState(value > PRESETS[PRESETS.length - 1]);
  const [draft, setDraft] = useState(custom ? String(value) : "");

  function pickPreset(raw: string) {
    if (raw === OTHER) {
      setCustom(true);
      const start = value > PRESETS[PRESETS.length - 1] ? value : MIN_OTHER;
      setDraft(String(start));
      onChange(start);
      return;
    }
    setCustom(false);
    onChange(Number(raw));
  }

  function typeCount(raw: string) {
    setDraft(raw);
    const n = Number.parseInt(raw, 10);
    if (Number.isFinite(n)) onChange(Math.min(Math.max(n, 1), MAX_OTHER));
  }

  return (
    <div className={custom ? "grid grid-cols-[minmax(0,1fr)_7rem] gap-3" : undefined}>
      <select
        id={id}
        value={custom ? OTHER : String(value)}
        onChange={(e) => pickPreset(e.target.value)}
        className={className}
      >
        {PRESETS.map((n) => (
          <option key={n} value={n}>
            {n} {n === 1 ? singular : plural}
          </option>
        ))}
        <option value={OTHER}>Other (9+)</option>
      </select>

      {custom ? (
        <input
          type="number"
          inputMode="numeric"
          min={MIN_OTHER}
          max={MAX_OTHER}
          value={draft}
          onChange={(e) => typeCount(e.target.value)}
          onBlur={() => {
            // Settle an empty or out-of-range entry on something sensible.
            const n = Number.parseInt(draft, 10);
            const settled = Number.isFinite(n) ? Math.min(Math.max(n, 1), MAX_OTHER) : MIN_OTHER;
            setDraft(String(settled));
            onChange(settled);
          }}
          aria-label="Exact number of passengers"
          placeholder="e.g. 12"
          className={className}
          autoFocus
        />
      ) : null}
    </div>
  );
}
