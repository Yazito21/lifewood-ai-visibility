function tryParse(text: string): unknown {
  try { return JSON.parse(text); } catch { return undefined; }
}

/** Parses a model reply as JSON: raw, inside a ```json fence, or the outermost {...} span. */
export function extractJson(text: string): unknown {
  const raw = tryParse(text.trim());
  if (raw !== undefined) return raw;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const fromFence = fenced ? tryParse(fenced.trim()) : undefined;
  if (fromFence !== undefined) return fromFence;
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  const span = start >= 0 && end > start ? tryParse(text.slice(start, end + 1)) : undefined;
  if (span !== undefined) return span;
  throw new Error("MODEL_JSON_INVALID");
}
