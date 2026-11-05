import type { CrawlerAccess, RobotsResult } from "./types.ts";

/** AI crawlers checked in robots.txt (list from geo-seo-claude scripts/fetch_page.py). */
export const AI_CRAWLERS = [
  "GPTBot", "OAI-SearchBot", "ChatGPT-User", "ClaudeBot", "anthropic-ai", "PerplexityBot", "CCBot", "Bytespider",
  "cohere-ai", "Google-Extended", "GoogleOther", "Applebot-Extended", "FacebookBot", "Amazonbot",
] as const;

/** The crawlers that feed the main AI answer engines; used for scoring. */
export const KEY_CRAWLERS = ["GPTBot", "OAI-SearchBot", "ChatGPT-User", "ClaudeBot", "PerplexityBot", "Google-Extended"] as const;

type Group = { agents: string[]; disallows: string[] };

function parseGroups(text: string): { groups: Group[]; sitemaps: string[] } {
  const groups: Group[] = [];
  const sitemaps: string[] = [];
  let current: Group | null = null;
  let lastWasAgent = false;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    const match = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!match) continue;
    const field = match[1].toLowerCase();
    const value = match[2].trim();
    if (field === "sitemap") {
      if (value) sitemaps.push(value);
      continue;
    }
    if (field === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], disallows: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (field === "disallow" && current) current.disallows.push(value);
  }
  return { groups, sitemaps };
}

function access(group: Group | undefined): CrawlerAccess {
  if (!group) return "allowed";
  const rules = group.disallows.filter(Boolean);
  if (rules.some((rule) => rule === "/" || rule === "/*")) return "blocked";
  return rules.length ? "partial" : "allowed";
}

/** Allow/deny per AI crawler. The most specific User-agent group wins (exact name, else *). */
export function parseRobots(text: string | null): RobotsResult {
  const crawlers: Record<string, CrawlerAccess> = {};
  if (text === null) {
    for (const name of AI_CRAWLERS) crawlers[name] = "allowed";
    return { exists: false, crawlers, sitemaps: [] };
  }
  const { groups, sitemaps } = parseGroups(text);
  const wildcard = groups.find((group) => group.agents.includes("*"));
  for (const name of AI_CRAWLERS) {
    const exact = groups.find((group) => group.agents.includes(name.toLowerCase()));
    crawlers[name] = access(exact ?? wildcard);
  }
  return { exists: true, crawlers, sitemaps };
}
