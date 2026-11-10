"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Info } from "lucide-react";
import { METRIC_DEFINITIONS, METRIC_VERSION, type MetricKey } from "@/lib/metric-definitions";

/**
 * Inline "i" control that explains how a metric is calculated. Works on hover, focus and tap.
 * Built only from phrasing elements (span, button) so it is valid inside <p>, <th> and labels.
 */
export function MetricInfo({ metric }: { metric: MetricKey }) {
  const definition = METRIC_DEFINITIONS[metric];
  const [open, setOpen] = useState(false);
  const wrapper = useRef<HTMLSpanElement>(null);
  const noteId = useId();

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === "Escape" : !wrapper.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", close); };
  }, [open]);

  return (
    <span ref={wrapper} className="relative ml-1.5 inline-block align-middle normal-case tracking-normal"
      onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        className="inline-flex cursor-pointer items-center text-[var(--muted-foreground)] hover:text-[var(--primary)]"
        aria-label={"How " + definition.label + " is calculated"}
        aria-expanded={open}
        aria-describedby={open ? noteId : undefined}
        title={definition.short}
      >
        <Info size={13} aria-hidden="true" />
      </button>
      {open && (
        <span id={noteId} role="note" className="absolute left-0 top-6 z-30 block w-72 rounded-xl border border-[var(--border)] bg-[var(--card)] p-3 text-left text-xs font-normal leading-relaxed text-[var(--foreground)] shadow-xl">
          <span className="block font-semibold">{definition.label} <span className="font-normal text-[var(--muted-foreground)]">({METRIC_VERSION})</span></span>
          <span className="mt-1 block">{definition.short}</span>
          {definition.detail.length > 0 && (
            <span className="mt-2 block space-y-1 text-[var(--muted-foreground)]">
              {definition.detail.map((line) => <span key={line} className="block pl-3 -indent-3">• {line}</span>)}
            </span>
          )}
        </span>
      )}
    </span>
  );
}
