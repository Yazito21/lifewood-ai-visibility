export type ReplacementLocationScopeResult =
  | { ok: true; location: string }
  | { ok: false; code: "REPLACEMENT_REQUIRES_SINGLE_TRACKING_LOCATION"; locations: string[] };

/**
 * The current atomic replacement RPC validates a single project tracking
 * location. Reject unsupported multi-location persistent runs before creating
 * a run or calling a provider, rather than spending tokens on an unpublishable
 * candidate. Sample mode does not use this publication path.
 */
export function validateReplacementLocationScope(
  locations: string[],
): ReplacementLocationScopeResult {
  const normalized = [...new Set(locations.map((value) => String(value).trim()).filter(Boolean))];
  if (normalized.length !== 1) {
    return {
      ok: false,
      code: "REPLACEMENT_REQUIRES_SINGLE_TRACKING_LOCATION",
      locations: normalized,
    };
  }
  return { ok: true, location: normalized[0] };
}
