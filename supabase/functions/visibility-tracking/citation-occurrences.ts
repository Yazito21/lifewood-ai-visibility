export type CitationEntity = { id: string; websites: string[] };
export type CitationResponse = {
  response_id: string;
  project_id: string;
  topic: string;
  metric_date: string;
  provider: string;
  tracking_location: string;
  run_id: string | null;
  citations: Array<{ url: string }>;
};

export function canonicalCitationUrl(value: string): string {
  try {
    const url = new URL(value);
    url.hash = "";
    url.protocol = "https:";
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|gclid$|dclid$|fbclid$|msclkid$|yclid$|_ga$|_gl$|ref$|source$|campaign$)/i.test(key)) {
        url.searchParams.delete(key);
      }
    }
    url.searchParams.sort();
    return url.toString().replace(/\/$/, "");
  } catch {
    return value.trim();
  }
}

function normalizedHost(value: string): string {
  try {
    return new URL(value.includes("://") ? value : "https://" + value)
      .hostname.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
  } catch { return ""; }
}

function hostMatches(host: string, registered: string): boolean {
  const domain = normalizedHost(registered);
  return Boolean(domain && (host === domain || host.endsWith("." + domain)));
}

/** One normalized row per response/entity/canonical URL. */
export function buildCitationOccurrenceRows(
  responses: CitationResponse[],
  entitiesByTopic: Map<string, CitationEntity[]>,
  trackedEntityId: string,
  trackedWebsites: string[],
) {
  const rows = new Map<string, Record<string, unknown>>();
  for (const response of responses) {
    const entities = [
      { id: trackedEntityId, websites: trackedWebsites },
      ...(entitiesByTopic.get(response.topic) ?? []),
    ];
    for (const citation of response.citations ?? []) {
      if (!/^https?:\/\//i.test(citation.url)) continue;
      const canonical_url = canonicalCitationUrl(citation.url);
      const canonical_domain = normalizedHost(canonical_url);
      if (!canonical_domain) continue;
      for (const entity of entities) {
        if (!entity.id || !entity.websites.some((site) => hostMatches(canonical_domain, site))) continue;
        const key = [response.response_id, entity.id, canonical_url].join("\u0000");
        if (rows.has(key)) continue;
        rows.set(key, {
          project_id: response.project_id,
          response_id: response.response_id,
          entity_id: entity.id,
          topic: response.topic,
          metric_date: response.metric_date,
          provider: response.provider,
          tracking_location: response.tracking_location,
          run_id: response.run_id,
          citation_url: citation.url,
          canonical_url,
          canonical_domain,
          citation_index: 1,
        });
      }
    }
  }
  return [...rows.values()];
}
