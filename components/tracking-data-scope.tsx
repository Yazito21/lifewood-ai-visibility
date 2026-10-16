"use client";

type Props = {
  trackingLocation: string;
  scope: "current" | "legacy";
  onScopeChange: (scope: "current" | "legacy") => void;
};

function locationName(value: string) {
  if (value === "GLOBAL") return "Global";
  try { return new Intl.DisplayNames(["en"], { type: "region" }).of(value) ?? value; }
  catch { return value; }
}

export function TrackingDataScope({ trackingLocation, scope, onScopeChange }: Props) {
  return (
    <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--line)] bg-white/80 p-3">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--muted-foreground)]">Reporting dataset</p>
        <p className="mt-1 text-sm font-semibold">{scope === "legacy" ? "Legacy / Location Unknown" : "Current location: " + locationName(trackingLocation)}</p>
        <p className="mt-1 text-xs text-[var(--muted-foreground)]">
          {scope === "legacy"
            ? "Historical records collected before reliable location tracking. These are kept separate from current-location results."
            : "Only runs collected for the project's currently selected tracking location are included."}
        </p>
      </div>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Reporting dataset">
        <button type="button" onClick={() => onScopeChange("current")} aria-pressed={scope === "current"} className={"ops-filter-btn " + (scope === "current" ? "is-active" : "")}>Current location</button>
        <button type="button" onClick={() => onScopeChange("legacy")} aria-pressed={scope === "legacy"} className={"ops-filter-btn " + (scope === "legacy" ? "is-active" : "")}>Legacy data</button>
      </div>
    </div>
  );
}
