"use client";

import { useId, type InputHTMLAttributes } from "react";

/**
 * The design's "field": a filled rounded box with the label *inside*, above the
 * value — not a floating label and not a separate label above the box.
 *
 * Figma values: fill #F5F9FD, 1px border #D3E1F0, ~12px radius, label 10px bold
 * #527193, value 14.5px bold #04182E. Dark mode swaps to #182437 / #26344A / #8595AB.
 */
interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "id"> {
  label: string;
  error?: string;
  hint?: string;
}

export function TextField({ label, error, hint, className = "", ...props }: TextFieldProps) {
  const id = useId();

  return (
    <div className={className}>
      <div
        className={`rounded-field border bg-surface-raised px-4 py-3 transition-colors focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/15 ${
          error ? "border-danger" : "border-border"
        }`}
      >
        <label htmlFor={id} className="block text-label font-bold text-fg-muted">
          {label}
        </label>
        <input
          id={id}
          {...props}
          aria-invalid={error ? true : props["aria-invalid"]}
          aria-describedby={error || hint ? `${id}-message` : props["aria-describedby"]}
          className="field-input mt-0.5 w-full bg-transparent text-body font-bold text-fg outline-none placeholder:font-normal placeholder:text-fg-muted"
        />
      </div>

      {error ? (
        <p id={`${id}-message`} className="mt-1.5 text-link font-bold text-danger">{error}</p>
      ) : hint ? (
        <p id={`${id}-message`} className="mt-1.5 text-link text-fg-muted">{hint}</p>
      ) : null}
    </div>
  );
}
