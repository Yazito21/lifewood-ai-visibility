// Pure helpers for showing and editing a saved audit report.
import type { Narrative, ReportEdits, ReportSnapshot, ReportStatus } from "./report-types.ts";

export type Tone = "good" | "fair" | "poor";

/** Mirrors public.can_edit_project(): superadmin, project admin, or the platform admin who created the project. */
export function canEditProject(profileRole: string | null | undefined, memberRole: string | null | undefined, createdByUser: boolean): boolean {
  return profileRole === "superadmin" || memberRole === "admin" || memberRole === "superadmin" || (profileRole === "admin" && createdByUser);
}

const STALE_AFTER_MS = 10 * 60 * 1000;

/** Rating bands from the geo-audit skill (same as site-audit scoring.ts). */
export function rating(score: number | null): { label: string; tone: Tone } {
  if (score === null || !Number.isFinite(score)) return { label: "Not measured", tone: "fair" };
  if (score >= 90) return { label: "Excellent", tone: "good" };
  if (score >= 75) return { label: "Good", tone: "good" };
  if (score >= 60) return { label: "Fair", tone: "fair" };
  if (score >= 40) return { label: "Poor", tone: "poor" };
  return { label: "Critical", tone: "poor" };
}

function valueAt(source: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((node, key) => {
    if (node === null || node === undefined) return undefined;
    return (node as Record<string, unknown>)[key];
  }, source);
}

/** The edited text for a block if an admin changed it, otherwise the generated text. */
export function textFor(narrative: Narrative | null, edits: ReportEdits, path: string): string {
  const edited = edits.text?.[path];
  if (typeof edited === "string") return edited;
  const generated = valueAt(narrative, path);
  return typeof generated === "string" ? generated : "";
}

/** Sets (or, with null, removes) an admin override for a text block. */
export function setText(edits: ReportEdits, path: string, value: string | null): ReportEdits {
  const text = { ...(edits.text ?? {}) };
  if (value === null) delete text[path];
  else text[path] = value;
  return { ...edits, text };
}

export type TargetRow = { scope: string; currentScore: number | null; targetScore: number | null; currentRank: number | null; targetRank: number | null };

const round1 = (n: number) => Math.round(n * 10) / 10;

function suggest(scope: string, score: number | null, rank: number | null): TargetRow {
  return {
    scope,
    currentScore: score,
    targetScore: score === null ? null : Math.min(100, round1(score + Math.max(5, score * 0.25))),
    currentRank: rank,
    targetRank: rank === null ? null : Math.max(1, rank - 2),
  };
}

/** Overall plus up to three categories with the lowest visibility. */
export function suggestedTargets(snapshot: ReportSnapshot): TargetRow[] {
  const categories = [...(snapshot.byCategory ?? [])]
    .filter((c) => c.visibilityScore !== null)
    .sort((a, b) => (a.visibilityScore ?? 0) - (b.visibilityScore ?? 0))
    .slice(0, 3);
  return [
    suggest("Overall", snapshot.overall?.visibilityScore ?? null, snapshot.overall?.rank ?? null),
    ...categories.map((c) => suggest(c.category, c.visibilityScore, c.rank)),
  ];
}

export function targetsFor(snapshot: ReportSnapshot, edits: ReportEdits): TargetRow[] {
  const overrides = new Map((edits.targets ?? []).map((t) => [t.scope, t]));
  return suggestedTargets(snapshot).map((row) => {
    const edit = overrides.get(row.scope);
    return edit ? { ...row, targetScore: edit.targetScore, targetRank: edit.targetRank } : row;
  });
}

/** A report still queued or running after 10 minutes without progress is treated as failed. */
export function effectiveStatus(row: { status: string; updated_at: string }, now = Date.now()): ReportStatus {
  const status = row.status as ReportStatus;
  if ((status === "queued" || status === "running") && now - Date.parse(row.updated_at) > STALE_AFTER_MS) return "failed";
  return status;
}

export function fmtScore(n: number | null | undefined, dp = 1): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return n.toLocaleString("en-GB", { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

export function fmtPercent(n: number | null | undefined, dp = 1): string {
  const text = fmtScore(n, dp);
  return text === "—" ? text : text + "%";
}

export function fmtDate(iso: string): string {
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(iso);
  const date = new Date(dateOnly ? iso + "T00:00:00Z" : iso);
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: dateOnly ? "UTC" : "Asia/Kuala_Lumpur" });
}

export const STEP_ORDER = ["crawling", "checking", "competitors", "scoring_content", "writing", "saving"] as const;

export const STEP_LABELS: Record<string, string> = {
  crawling: "Crawling the website",
  checking: "Running SEO and GEO checks",
  competitors: "Checking competitors",
  scoring_content: "Scoring content quality (E-E-A-T)",
  writing: "Writing the report",
  saving: "Saving",
};
