"use client";

import { useEffect, useId, useRef, useState } from "react";

/**
 * The pickup and drop-off fields, with Google Places suggestions behind them.
 *
 * Still a plain text input underneath, on purpose. The form posts the address string
 * exactly as it did before suggestions existed, so a customer can type an address the
 * provider does not know — a private airstrip, a new development — and still book.
 * Choosing a suggestion fills the field; it does not become a required step.
 *
 * With NEXT_PUBLIC_PLACES_ENABLED unset this degrades to that same plain input.
 */

const PLACES_ENABLED = process.env.NEXT_PUBLIC_PLACES_ENABLED === "true";

/** Mirrors the payload of /api/places/autocomplete. */
interface PlaceSuggestion {
  description: string;
  placeId: string;
}

/** Long enough that a typed address settles, short enough to feel immediate. */
const DEBOUNCE_MS = 250;

export function AddressAutocomplete({
  id,
  value,
  onChange,
  placeholder,
  className,
}: {
  id: string;
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const listId = useId();

  /**
   * Set when the value came from a click or Enter on a suggestion. Without it, filling
   * the field would immediately re-query with the text just chosen and reopen the list.
   */
  const justPicked = useRef(false);

  useEffect(() => {
    if (!PLACES_ENABLED) return;

    if (justPicked.current) {
      justPicked.current = false;
      return;
    }

    const query = value.trim();
    if (query.length < 3) {
      setSuggestions([]);
      setOpen(false);
      return;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(
          `/api/places/autocomplete?input=${encodeURIComponent(query)}`,
          { cache: "no-store" },
        );
        if (!response.ok) return;

        const body = (await response.json()) as { suggestions: PlaceSuggestion[] };
        // A later keystroke may have resolved first; this effect's result is stale.
        if (cancelled) return;

        setSuggestions(body.suggestions);
        setOpen(body.suggestions.length > 0);
        setActive(-1);
      } catch {
        // Offline or blocked: leave the field as a plain input rather than erroring.
      }
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [value]);

  function pick(suggestion: PlaceSuggestion) {
    justPicked.current = true;
    onChange(suggestion.description);
    setOpen(false);
    setSuggestions([]);
    setActive(-1);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || suggestions.length === 0) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((i) => (i + 1) % suggestions.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
    } else if (event.key === "Enter" && active >= 0) {
      // Only swallow Enter when a suggestion is highlighted, so the key still
      // submits the step for someone typing an address the provider does not list.
      event.preventDefault();
      pick(suggestions[active]);
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div className="relative">
      <input
        id={id}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        // A blur that fires before the click would close the list first and swallow it.
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onFocus={() => setOpen(suggestions.length > 0)}
        placeholder={placeholder}
        className={className}
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
      />

      {open && suggestions.length > 0 ? (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-50 mt-1 w-full overflow-hidden rounded-xl border border-white/20 bg-black/95 shadow-xl backdrop-blur"
        >
          {suggestions.map((suggestion, index) => (
            <li key={suggestion.placeId} role="option" aria-selected={index === active}>
              <button
                type="button"
                // mousedown, not click: blur would otherwise close the list first.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(suggestion)}
                onMouseEnter={() => setActive(index)}
                className={`block w-full px-4 py-2.5 text-left text-sm transition-colors ${
                  index === active ? "bg-white/10 text-white" : "text-white/75"
                }`}
              >
                {suggestion.description}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
