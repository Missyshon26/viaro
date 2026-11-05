import type { ReactNode } from "react";

/**
 * Content that slides open and shut instead of popping in and out.
 *
 * It animates the height with a grid row going between 0fr and 1fr, which needs no measuring
 * and works for any content. While shut, the content is hidden from screen readers and
 * keyboard focus (`inert`), so Tab never lands in a field nobody can see. People who prefer
 * reduced motion get no animation (the global stylesheet shortens every transition for them).
 */
export function Collapse({ open, children, id }: { open: boolean; children: ReactNode; id?: string }) {
  return (
    <div
      id={id}
      className={`grid transition-[grid-template-rows,opacity] duration-300 ease-out ${
        open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
      }`}
    >
      {/* min-h-0 lets the row shrink to nothing; overflow-hidden clips the content while it does. */}
      <div className="min-h-0 overflow-hidden" inert={!open}>
        {children}
      </div>
    </div>
  );
}
