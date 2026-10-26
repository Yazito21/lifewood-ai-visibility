// Mirrors public.metric_definitions (version v2) so labels render without a round trip.
// Keep the wording in sync with supabase/migrations/20261026120000_metric_pipeline_schema.sql.

export type MetricKey =
  | "visibility_score"
  | "visibility_rank"
  | "share_of_voice"
  | "citation_occurrences"
  | "unique_cited_pages"
  | "unique_cited_domains";

export const METRIC_VERSION = "v2";

export const METRIC_DEFINITIONS: Record<MetricKey, { label: string; short: string; detail: string[] }> = {
  visibility_score: {
    label: "Visibility Score",
    short: "Share of valid AI responses that mention the brand at least once.",
    detail: [
      "Numerator: distinct valid responses mentioning the entity (repeat mentions in one response count once).",
      "Denominator: distinct valid completed responses for the same topic, engine, date and location.",
      "Tracked brand and competitors use the identical calculation.",
      "Overall pools the responses of all topics published that day; it is not an average of topic scores.",
    ],
  },
  visibility_rank: {
    label: "Visibility Rank",
    short: "Position among the tracked brand and competitors with valid observations in the same scope. 1 is best.",
    detail: [
      "The number after the slash is the rank population: the tracked brand plus competitors with at least one valid response in that scope.",
      "Rank compares exact unrounded scores. Equal scores share a rank (1, 1, 3).",
      "Competitors without a valid observation are excluded, never counted as zero.",
      "Rows labelled \"population unverified\" predate verified run lineage.",
    ],
  },
  share_of_voice: {
    label: "Share of Voice",
    short: "The brand's share of all entity mentions in the scope.",
    detail: ["Mentions of the tracked brand divided by mentions of the tracked brand plus eligible competitors."],
  },
  citation_occurrences: {
    label: "Citation Occurrences",
    short: "Cited URLs attributed to the entity. One canonical URL counts once per response.",
    detail: [
      "The same URL cited in separate responses counts once per response; repeats inside one response count once.",
      "Tracked brand and competitors use the identical attribution rule.",
      "Unique pages and unique domains are separate, smaller counts.",
    ],
  },
  unique_cited_pages: {
    label: "Unique Cited Pages",
    short: "Distinct canonical URLs cited for the entity in the scope.",
    detail: [],
  },
  unique_cited_domains: {
    label: "Unique Cited Domains",
    short: "Distinct canonical domains cited for the entity in the scope.",
    detail: [],
  },
};
