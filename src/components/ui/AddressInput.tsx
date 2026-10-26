"use client";

import { useEffect, useId, useRef, useState } from "react";
import { api } from "@/lib/api/client";
import { IconPin } from "@/components/ui/AddressIcons";

/**
 * A text field for an address with Google Places suggestions under it.
 *
 * Still a plain text input underneath: an operator can type an address the provider does not
 * know, and choosing a suggestion only fills the field. Suggestions come from this app's own
 * /api/places/autocomplete route, which keeps the Google key on the server.
 */
interface Suggestion {
  description: string;
  placeId: string;
}

const DEBOUNCE_MS = 250;

export function AddressInput({
  id,
  value,
  onChange,
  className,
  placeholder,
}: {
  id: string;
  value: string;
  onChange: (next: string) => void;
  className?: string;
  placeholder?: string;
}) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const listId = useId();
  const justPicked = useRef(false);
  const focused = useRef(false);

  useEffect(() => {
    if (justPicked.current) {
      justPicked.current = false;
      return;
    }
    const query = value.trim();
    if (query.length < 3 || !focused.current) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- nothing to suggest for this text
      setSuggestions([]);
      setOpen(false);
      return;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        // Straight to the API (admin-only, key on the server): one hop, with the session handled
        // like every other call, instead of through a second route that had to check it again.
        const body = await api.get<{ suggestions: Suggestion[] }>("/admin/places/autocomplete", { query: { input: query } });
        if (cancelled || !focused.current) return;
        setSuggestions(body.suggestions);
        setOpen(body.suggestions.length > 0);
        setActive(-1);
      } catch {
        /* Offline or blocked: it stays a plain input. */
      }
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [value]);

  function pick(suggestion: Suggestion) {
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
      event.preventDefault();
      pick(suggestions[active]);
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div className="relative min-w-0 flex-1">
      <input
        id={id}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        onFocus={() => {
          focused.current = true;
          setOpen(suggestions.length > 0);
        }}
        onBlur={() => {
          focused.current = false;
          // A blur that fires before the click would close the list first and swallow it.
          setTimeout(() => setOpen(false), 150);
        }}
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
          className="absolute z-50 mt-1.5 max-h-72 w-full overflow-y-auto rounded-field border border-border bg-surface-raised p-1.5 shadow-[var(--shadow-raised)]"
        >
          {suggestions.map((suggestion, index) => {
            const comma = suggestion.description.indexOf(",");
            const main = comma > 0 ? suggestion.description.slice(0, comma) : suggestion.description;
            const rest = comma > 0 ? suggestion.description.slice(comma + 1).trim() : "";
            return (
              <li key={suggestion.placeId} role="option" aria-selected={index === active}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(suggestion)}
                  onMouseEnter={() => setActive(index)}
                  className={`flex w-full items-start gap-3 rounded-field px-3 py-2.5 text-left transition-colors ${
                    index === active ? "bg-accent-soft" : ""
                  }`}
                >
                  <span
                    aria-hidden
                    className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
                      index === active ? "bg-primary text-primary-fg" : "bg-surface text-accent"
                    }`}
                  >
                    <IconPin />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-meta font-bold text-fg">{main}</span>
                    {rest ? <span className="block truncate text-label text-fg-muted">{rest}</span> : null}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
