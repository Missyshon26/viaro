import type { ButtonHTMLAttributes, ReactNode } from "react";

/**
 * Primary action button.
 *
 * Figma: full-width, 14.5px bold label, ~12px radius, ~48px tall.
 * Light theme fills with the navy (#04182E); dark promotes blue (#1273D4) — both
 * come from --primary so this component never branches on theme.
 */
type Variant = "primary" | "secondary" | "ghost" | "accent" | "onPanel";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  loading?: boolean;
  /** Desktop buttons hug their label; the mobile screens are full-width. */
  block?: boolean;
  children: ReactNode;
}

const variants: Record<Variant, string> = {
  primary: "bg-primary text-primary-fg",
  secondary: "bg-surface-raised text-fg border border-border",
  ghost: "bg-transparent text-accent",
  // Desktop marketing fills its CTAs with the accent blue, not the navy.
  accent: "bg-primary text-primary-fg",
  // Sitting on a --panel band, the button inverts to the page background.
  onPanel: "bg-bg text-fg",
};

export function Button({
  variant = "primary",
  loading = false,
  block = true,
  disabled,
  className = "",
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      disabled={disabled || loading}
      aria-busy={loading}
      className={`inline-flex h-12 items-center justify-center rounded-field px-6 text-body font-bold gap-2 transition-colors hover:brightness-110 disabled:opacity-50 ${
        block ? "w-full" : ""
      } ${variants[variant]} ${className}`}
    >
      {loading ? "Please wait…" : children}
    </button>
  );
}

/**
 * The same shapes as <Button>, for the many places the design draws a button that
 * navigates. Kept beside Button so the two can never drift apart.
 */
export const buttonClass = (variant: Variant = "accent", block = false) =>
  `inline-flex h-11 items-center justify-center rounded-field px-6 text-action font-bold transition-opacity hover:opacity-90 ${
    block ? "w-full" : ""
  } ${variants[variant]}`;
