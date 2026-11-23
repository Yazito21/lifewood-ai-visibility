"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Info } from "lucide-react";
import { METRIC_DEFINITIONS, METRIC_VERSION, type MetricKey } from "@/lib/metric-definitions";

/**
 * Inline metric help. The popover is portalled to document.body so it is not
 * clipped by overflow, stacking contexts, or transformed dashboard cards.
 */
export function MetricInfo({ metric }: { metric: MetricKey }) {
  const definition = METRIC_DEFINITIONS[metric];
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const wrapper = useRef<HTMLSpanElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const popover = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const noteId = useId();

  function cancelClose() {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }

  function scheduleClose() {
    cancelClose();
    closeTimer.current = setTimeout(() => setOpen(false), 140);
  }

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }

    const place = () => {
      const anchor = trigger.current;
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      const width = Math.min(288, window.innerWidth - 16);
      const estimatedHeight = Math.min(220, window.innerHeight - 16);
      const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
      const below = rect.bottom + 8 + estimatedHeight <= window.innerHeight - 8;
      const top = below
        ? rect.bottom + 8
        : Math.max(8, rect.top - estimatedHeight - 8);
      setPosition({ top, left });
    };

    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent) {
        if (event.key === "Escape") setOpen(false);
        return;
      }
      const target = event.target as Node;
      if (!wrapper.current?.contains(target) && !popover.current?.contains(target)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  useEffect(() => () => cancelClose(), []);

  return (
    <span
      ref={wrapper}
      className="ml-1.5 inline-block align-middle normal-case tracking-normal"
      onMouseEnter={() => { cancelClose(); setOpen(true); }}
      onMouseLeave={scheduleClose}
    >
      <button
        ref={trigger}
        type="button"
        onClick={() => { cancelClose(); setOpen((value) => !value); }}
        onFocus={() => { cancelClose(); setOpen(true); }}
        className="inline-flex cursor-pointer items-center text-[var(--muted-foreground)] hover:text-[var(--primary)]"
        aria-label={"How " + definition.label + " is calculated"}
        aria-expanded={open}
        aria-describedby={open ? noteId : undefined}
        title={definition.short}
      >
        <Info size={13} aria-hidden="true" />
      </button>
      {open && position && typeof document !== "undefined" && createPortal(
        <div
          ref={popover}
          id={noteId}
          role="note"
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
          style={{ position: "fixed", top: position.top, left: position.left, zIndex: 10000 }}
          className="block w-72 max-w-[calc(100vw-1rem)] max-h-[calc(100vh-1rem)] overflow-y-auto whitespace-normal break-words rounded-xl border border-[var(--border)] bg-[var(--card)] p-3 text-left text-xs font-normal leading-relaxed text-[var(--foreground)] shadow-xl"
        >
          <span className="block font-semibold">
            {definition.label} <span className="font-normal text-[var(--muted-foreground)]">({METRIC_VERSION})</span>
          </span>
          <span className="mt-1 block">{definition.short}</span>
          {definition.detail.length > 0 && (
            <span className="mt-2 block space-y-1 text-[var(--muted-foreground)]">
              {definition.detail.map((line) => <span key={line} className="block pl-3 -indent-3">• {line}</span>)}
            </span>
          )}
        </div>,
        document.body
      )}
    </span>
  );
}
