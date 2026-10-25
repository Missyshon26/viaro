"use client";

import { useState } from "react";

export interface AccordionItem {
  question: string;
  answer: string;
}

/**
 * The FAQ list on 01 · Home — a 753px column of rows, each a bold question with a
 * "+" at the right edge. The design shows every answer open; here the first row is
 * open and the rest expand, which is the same content one interaction away.
 */
export function Accordion({ items }: { items: AccordionItem[] }) {
  const [open, setOpen] = useState(0);

  return (
    <div className="divide-y divide-border-subtle border-y border-border-subtle">
      {items.map((item, index) => {
        const expanded = open === index;
        return (
          <div key={item.question}>
            <h3>
              <button
                type="button"
                onClick={() => setOpen(expanded ? -1 : index)}
                aria-expanded={expanded}
                className="flex w-full items-center gap-4 py-4 text-left"
              >
                <span className="text-action font-bold text-fg">{item.question}</span>
                <span
                  aria-hidden
                  className="ml-auto shrink-0 text-card font-bold text-fg-muted"
                >
                  {expanded ? "–" : "+"}
                </span>
              </button>
            </h3>
            {expanded && (
              <p className="pb-4 text-meta leading-relaxed text-fg-body">{item.answer}</p>
            )}
          </div>
        );
      })}
    </div>
  );
}
