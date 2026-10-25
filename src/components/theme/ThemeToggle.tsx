"use client";

import { useSyncExternalStore } from "react";

export type Theme = "light" | "dark";

const STORAGE_KEY = "abl-theme-v2";

/**
 * The applied theme lives on <html>, put there by ThemeScript before paint. That
 * makes it an external store: reading it into state inside an effect would render
 * one frame with the wrong icon, so it is subscribed to instead.
 */
const listeners = new Set<() => void>();

const getTheme = (): Theme =>
  document.documentElement.classList.contains("dark") ? "dark" : "light";

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useTheme() {
  const theme = useSyncExternalStore(subscribe, getTheme, () => "light" as Theme);

  function apply(next: Theme) {
    document.documentElement.classList.toggle("dark", next === "dark");
    localStorage.setItem(STORAGE_KEY, next);
    listeners.forEach((listener) => listener());
  }

  return { theme, setTheme: apply, toggle: () => apply(theme === "dark" ? "light" : "dark") };
}

/** Small control used on the Account screens; the design ships both palettes. */
export function ThemeToggle({ className = "" }: { className?: string }) {
  const { theme, toggle } = useTheme();

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
      className={`inline-flex h-9 w-9 items-center justify-center rounded-full bg-surface text-fg ${className}`}
    >
      {theme === "dark" ? "☾" : "☀"}
    </button>
  );
}
