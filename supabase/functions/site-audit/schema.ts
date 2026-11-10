export type SchemaResult = {
  blocks: number;
  invalidBlocks: number;
  types: string[];
  sameAs: string[];
  hasOrganization: boolean;
  hasWebSite: boolean;
  contentTypes: string[];
};

const ORGANIZATION_TYPES = new Set(["Organization", "LocalBusiness", "Corporation", "ProfessionalService", "NGO", "EducationalOrganization"]);
const CONTENT_TYPES = ["Article", "BlogPosting", "Product", "Service", "FAQPage", "HowTo", "BreadcrumbList", "Review"];

function isOrganization(type: string): boolean {
  return ORGANIZATION_TYPES.has(type) || type.endsWith("Business") || type.endsWith("Organization");
}

function collectNodes(value: unknown, out: Record<string, unknown>[]) {
  if (Array.isArray(value)) {
    for (const item of value) collectNodes(item, out);
    return;
  }
  if (!value || typeof value !== "object") return;
  const node = value as Record<string, unknown>;
  out.push(node);
  if (node["@graph"]) collectNodes(node["@graph"], out);
}

function typesOf(node: Record<string, unknown>): string[] {
  const raw = node["@type"];
  const list = Array.isArray(raw) ? raw : [raw];
  return list.filter((t): t is string => typeof t === "string").map((t) => t.replace(/^https?:\/\/schema\.org\//, ""));
}

function stringsOf(value: unknown): string[] {
  const list = Array.isArray(value) ? value : [value];
  return list.filter((v): v is string => typeof v === "string" && v.trim() !== "").map((v) => v.trim());
}

/** JSON-LD found on a page: types, organisation/website markup, sameAs profiles and content types. */
export function extractSchema(html: string): SchemaResult {
  const nodes: Record<string, unknown>[] = [];
  let blocks = 0;
  let invalidBlocks = 0;
  for (const match of html.matchAll(/<script[^>]+type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    blocks++;
    try {
      collectNodes(JSON.parse(match[1].trim()), nodes);
    } catch {
      invalidBlocks++;
    }
  }
  const types = new Set<string>();
  const sameAs = new Set<string>();
  for (const node of nodes) {
    for (const type of typesOf(node)) types.add(type);
    for (const link of stringsOf(node.sameAs)) sameAs.add(link);
  }
  const typeList = [...types];
  return {
    blocks,
    invalidBlocks,
    types: typeList,
    sameAs: [...sameAs],
    hasOrganization: typeList.some(isOrganization),
    hasWebSite: types.has("WebSite"),
    contentTypes: CONTENT_TYPES.filter((type) => types.has(type)),
  };
}

/** Union of the schema found across several pages. */
export function mergeSchema(results: SchemaResult[]): SchemaResult {
  const types = new Set(results.flatMap((r) => r.types));
  return {
    blocks: results.reduce((sum, r) => sum + r.blocks, 0),
    invalidBlocks: results.reduce((sum, r) => sum + r.invalidBlocks, 0),
    types: [...types],
    sameAs: [...new Set(results.flatMap((r) => r.sameAs))],
    hasOrganization: results.some((r) => r.hasOrganization),
    hasWebSite: results.some((r) => r.hasWebSite),
    contentTypes: CONTENT_TYPES.filter((type) => types.has(type)),
  };
}
