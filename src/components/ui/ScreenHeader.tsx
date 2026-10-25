"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";

/**
 * Screen header from the mobile designs: a circular back button on the left and a
 * 16.5px bold title beside it.
 *
 * Note the Figma frames also draw an iOS status bar (9:41, Dynamic Island) and a
 * home indicator — those are the device mockup, not app UI, so they are not built.
 * The real status bar belongs to the phone.
 */
export function ScreenHeader({
  title,
  onBack,
  action,
  showBack = true,
}: {
  title: string;
  onBack?: () => void;
  action?: ReactNode;
  showBack?: boolean;
}) {
  const router = useRouter();

  return (
    <header className="flex items-center gap-3 px-4 pt-2 pb-4">
      {showBack && (
        <button
          type="button"
          onClick={onBack ?? (() => router.back())}
          aria-label="Go back"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface text-[17px] leading-none text-fg"
        >
          ‹
        </button>
      )}
      <h1 className="text-title font-bold text-fg">{title}</h1>
      {action && <div className="ml-auto">{action}</div>}
    </header>
  );
}
