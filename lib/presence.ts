import type { Presence } from "./report-types.ts";

const SOCIAL = ["linkedin.com", "facebook.com", "x.com", "twitter.com", "instagram.com", "youtube.com", "tiktok.com", "reddit.com", "quora.com", "medium.com", "pinterest.com"];
const DIRECTORIES = [
  "g2.com", "capterra.com", "clutch.co", "trustpilot.com", "yelp.com", "crunchbase.com", "glassdoor.com", "goodfirms.co",
  "sortlist.com", "yellowpages.com", "getapp.com", "softwareadvice.com", "tripadvisor.com", "gartner.com",
];

const matches = (host: string, domains: string[]) => domains.some((domain) => host === domain || host.endsWith("." + domain));

/** Groups a cited hostname for "external presence": social, directories, or other websites (incl. news). */
export function classifyHost(hostname: string): keyof Presence {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (matches(host, SOCIAL)) return "social";
  if (matches(host, DIRECTORIES)) return "directories";
  return "websites";
}
