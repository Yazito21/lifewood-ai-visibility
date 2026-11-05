export type AssetKind = "blog" | "case_studies" | "whitepapers" | "guides" | "faq" | "docs" | "news";
export type KnowledgeAssets = Record<AssetKind, number>;

const PATTERNS: [AssetKind, RegExp][] = [
  ["blog", /^\/(blog|insights|articles)(\/|$)/],
  ["case_studies", /^\/(case-stud[^/]*|customers|success-stor[^/]*)(\/|$)/],
  ["whitepapers", /^\/(whitepapers?|white-papers?|ebooks?|reports?)(\/|$)/],
  ["guides", /^\/(guides?|how-to|tutorials?)(\/|$)/],
  ["faq", /^\/(faqs?|help)(\/|$)/],
  ["docs", /^\/(docs|documentation|kb|knowledge[^/]*)(\/|$)/],
  ["news", /^\/(news|press|media)(\/|$)/],
];

/** Resource pages in a sitemap, by section. Each URL counts once; section index pages are not counted. */
export function countKnowledgeAssets(urls: string[]): KnowledgeAssets {
  const counts: KnowledgeAssets = { blog: 0, case_studies: 0, whitepapers: 0, guides: 0, faq: 0, docs: 0, news: 0 };
  const seen = new Set<string>();
  for (const raw of urls) {
    let path: string;
    try {
      path = new URL(raw).pathname.toLowerCase().replace(/\/+$/, "");
    } catch {
      continue;
    }
    if (seen.has(path)) continue;
    seen.add(path);
    if (path.split("/").filter(Boolean).length < 2) continue;
    const kind = PATTERNS.find(([, pattern]) => pattern.test(path))?.[0];
    if (kind) counts[kind]++;
  }
  return counts;
}

export function totalAssets(assets: KnowledgeAssets): number {
  return Object.values(assets).reduce((sum, n) => sum + n, 0);
}
