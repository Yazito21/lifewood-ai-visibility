import { fetchPublic } from "../_shared/safe-fetch.ts";
import { pageLinks } from "./crawl.ts";

type Deps = { fetch?: typeof fetch };

export const SOCIAL_HOSTS = {
  linkedin: ["linkedin.com"],
  youtube: ["youtube.com", "youtu.be"],
  x: ["x.com", "twitter.com"],
  facebook: ["facebook.com"],
  instagram: ["instagram.com"],
  tiktok: ["tiktok.com"],
  github: ["github.com"],
} as const;

export type SocialNetwork = keyof typeof SOCIAL_HOSTS;
export type SocialProfiles = Record<SocialNetwork, string | null>;

export type BrandAuthority = {
  wikipedia: { found: boolean; title: string | null; url: string | null };
  wikidata: { found: boolean; id: string | null };
  social: SocialProfiles;
};

const SHARE_PATH = /\/(sharing|share|intent|sharer|dialog)(\/|\.php|$|\?)/i;

function networkFor(url: string): SocialNetwork | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (SHARE_PATH.test(parsed.pathname) || parsed.pathname === "/" || parsed.pathname === "") return null;
  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  for (const [network, hosts] of Object.entries(SOCIAL_HOSTS)) {
    if (hosts.some((h) => host === h || host.endsWith("." + h))) return network as SocialNetwork;
  }
  return null;
}

/** Social profiles from JSON-LD sameAs first, then links on the homepage. */
export function findSocialProfiles(homepageHtml: string, sameAs: string[]): SocialProfiles {
  const profiles: SocialProfiles = { linkedin: null, youtube: null, x: null, facebook: null, instagram: null, tiktok: null, github: null };
  for (const url of [...sameAs, ...pageLinks(homepageHtml, "https://example.invalid/")]) {
    const network = networkFor(url);
    if (network && !profiles[network]) profiles[network] = url;
  }
  return profiles;
}

async function getJson(url: string, deps: Deps): Promise<unknown> {
  const page = await fetchPublic(url, { accept: "application/json", fetch: deps.fetch, maxBytes: 200_000 });
  if (!page.ok) return null;
  try {
    return JSON.parse(page.body);
  } catch {
    return null;
  }
}

/** A Wikipedia article whose title is the brand (or "Brand (qualifier)"). */
export async function lookupWikipedia(brand: string, deps: Deps = {}): Promise<BrandAuthority["wikipedia"]> {
  const data = await getJson(
    `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(brand)}&format=json&srlimit=3`,
    deps,
  ) as { query?: { search?: { title?: string }[] } } | null;
  const wanted = brand.trim().toLowerCase();
  const hit = (data?.query?.search ?? []).find((result) => {
    const title = (result.title ?? "").toLowerCase();
    return title === wanted || title.startsWith(wanted + " (");
  });
  if (!hit?.title) return { found: false, title: null, url: null };
  return { found: true, title: hit.title, url: "https://en.wikipedia.org/wiki/" + hit.title.replace(/ /g, "_") };
}

/** A Wikidata entity whose label is exactly the brand. */
export async function lookupWikidata(brand: string, deps: Deps = {}): Promise<BrandAuthority["wikidata"]> {
  const data = await getJson(
    `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(brand)}&language=en&format=json&limit=3`,
    deps,
  ) as { search?: { id?: string; label?: string }[] } | null;
  const wanted = brand.trim().toLowerCase();
  const hit = (data?.search ?? []).find((result) => (result.label ?? "").toLowerCase() === wanted);
  return hit?.id ? { found: true, id: hit.id } : { found: false, id: null };
}

const plus = (text: string) => encodeURIComponent(text).replace(/%20/g, "+");

/** Search links for platforms that cannot be checked automatically (as brand_scanner.py builds them). */
export function manualCheckLinks(brand: string): { platform: string; url: string }[] {
  const q = plus(brand);
  return [
    { platform: "Reddit", url: `https://www.reddit.com/search/?q=${q}` },
    { platform: "YouTube", url: `https://www.youtube.com/results?search_query=${q}` },
    { platform: "LinkedIn", url: `https://www.linkedin.com/search/results/companies/?keywords=${q}` },
    { platform: "G2", url: `https://www.g2.com/search?utf8=&query=${q}` },
    { platform: "Trustpilot", url: `https://www.trustpilot.com/search?query=${q}` },
    { platform: "Crunchbase", url: `https://www.crunchbase.com/textsearch?q=${q}` },
  ];
}
