"use client";

import { Info } from "lucide-react";
import { METRIC_DEFINITIONS, METRIC_VERSION, type MetricKey } from "@/lib/metric-definitions";

/** Inline "i" control that explains how a metric is calculated. Works on hover, focus and tap. */
export function MetricInfo({ metric }: { metric: MetricKey }) {
  const definition = METRIC_DEFINITIONS[metric];
  return (
    <details className="relative ml-1.5 inline-block align-middle normal-case tracking-normal">
      <summary
        className="inline-flex cursor-pointer list-none items-center text-[var(--muted-foreground)] hover:text-[var(--primary)]"
        aria-label={"How " + definition.label + " is calculated"}
        title={definition.short}
      >
        <Info size={13} aria-hidden="true" />
      </summary>
      <div role="note" className="absolute left-0 top-6 z-30 w-72 rounded-xl border border-[var(--border)] bg-[var(--card)] p-3 text-left text-xs font-normal leading-relaxed text-[var(--foreground)] shadow-xl">
        <p className="font-semibold">{definition.label} <span className="font-normal text-[var(--muted-foreground)]">({METRIC_VERSION})</span></p>
        <p className="mt-1">{definition.short}</p>
        {definition.detail.length > 0 && (
          <ul className="mt-2 list-disc space-y-1 pl-4 text-[var(--muted-foreground)]">
            {definition.detail.map((line) => <li key={line}>{line}</li>)}
          </ul>
        )}
      </div>
    </details>
  );
}
