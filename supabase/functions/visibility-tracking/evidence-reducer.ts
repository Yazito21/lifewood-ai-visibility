/**
 * Deterministic merge for evidence rows sharing the same persistence conflict key.
 *
 * Semantics:
 * - occurrence_count is additive (each input row represents distinct extracted evidence)
 * - first_position is the minimum valid non-negative position
 * - confidence takes the highest known tier; ties use a stable lexical tie-break
 * - evidence_text is a sorted, de-duplicated union of trimmed excerpts
 * - remaining scalar fields come from a stable canonical row, not input order
 */
export type EvidenceRow = Record<string, unknown>;

const confidenceRank: Record<string, number> = {
  deterministic: 4,
  high: 3,
  review_required: 2,
  medium: 2,
  low: 1,
};

function canonicalValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function stableRowKey(row: EvidenceRow): string {
  return Object.keys(row).sort().map((key) => key + ":" + canonicalValue(row[key])).join("\u0000");
}

function validCount(value: unknown): number {
  const number = Number(value ?? 0);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function validPosition(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function confidenceOf(rows: EvidenceRow[]): string | null {
  const values = [...new Set(rows.map((row) => String(row.confidence ?? "").trim()).filter(Boolean))];
  values.sort((a, b) => (confidenceRank[b.toLowerCase()] ?? 0) - (confidenceRank[a.toLowerCase()] ?? 0) || a.localeCompare(b));
  return values[0] ?? null;
}

export function reduceEvidenceRows(rows: EvidenceRow[]): EvidenceRow[] {
  const groups = new Map<string, EvidenceRow[]>();
  for (const row of rows) {
    const key = [row.response_id, row.brand_id, row.topic, row.match_source, row.matched_value]
      .map(canonicalValue).join("\u0000");
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }

  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, group]) => {
    const sorted = [...group].sort((a, b) => stableRowKey(a).localeCompare(stableRowKey(b)));
    const merged: EvidenceRow = { ...sorted[0] };
    const positions = group.map((row) => validPosition(row.first_position)).filter((v): v is number => v !== null);
    const excerpts = [...new Set(group.map((row) => String(row.evidence_text ?? "").trim()).filter(Boolean))].sort();
    merged.first_position = positions.length ? Math.min(...positions) : null;
    merged.occurrence_count = group.reduce((sum, row) => sum + validCount(row.occurrence_count), 0);
    merged.confidence = confidenceOf(group);
    merged.evidence_text = excerpts.join("\n---\n").slice(0, 4000);
    return merged;
  });
}
