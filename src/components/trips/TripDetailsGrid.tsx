"use client";

import { useEffect, useRef, type ReactNode } from "react";

/** Keep whole rows at three equal cards, or two equal cards for longer content. */
export function TripDetailsGrid({ children }: { children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const grid = root.current;
    if (!grid) return;
    let frame = 0;
    const layout = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const cards = Array.from(grid.children) as HTMLElement[];
        const width = grid.getBoundingClientRect().width;
        const columns = width >= 1000 ? 6 : width >= 640 ? 2 : 1;
        grid.style.gridTemplateColumns = `repeat(${columns}, minmax(0, 1fr))`;
        for (let index = 0; index < cards.length;) {
          const remaining = cards.length - index;
          // Two-card rows are halves, never a full-width card or a 2/3 + 1/3 split.
          const longContent = cards.slice(index, index + 3).some((card) => card.classList.contains("trip-card-wide"));
          const count = columns === 6 ? (longContent || remaining === 2 || remaining === 4 ? 2 : 3) : columns;
          const span = columns === 6 ? 6 / count : 1;
          for (const card of cards.slice(index, index + count)) card.style.gridColumn = `span ${span}`;
          index += count;
        }
      });
    };
    const resize = new ResizeObserver(layout);
    resize.observe(grid);
    const mutations = new MutationObserver(layout);
    mutations.observe(grid, { childList: true, attributes: true, attributeFilter: ["class"], subtree: true });
    layout();
    return () => { cancelAnimationFrame(frame); resize.disconnect(); mutations.disconnect(); };
  }, []);

  return <div ref={root} className="trip-details-grid">{children}</div>;
}
