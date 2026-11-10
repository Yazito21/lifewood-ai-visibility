import { isPublicHttpUrl, readTextCapped } from "./url-guard.ts";

export type FetchFailure = "unsafe_url" | "timeout" | "network" | "too_many_redirects" | "http_error";

export type FetchedPage =
  | { ok: true; url: string; status: number; contentType: string; headers: Headers; body: string }
  | { ok: false; url: string; status: number | null; reason: FetchFailure };

export type FetchPublicOptions = {
  accept: string;
  maxBytes?: number;
  timeoutMs?: number;
  fetch?: typeof fetch;
  /** Resolves a hostname to IP addresses. Defaults to DNS lookups in production (when `fetch` is not injected). */
  resolve?: (hostname: string) => Promise<string[]>;
};

const MAX_REDIRECTS = 3;
export const USER_AGENT = "LifewoodAIVisibilityBot/1.0 (+https://lifewood.com)";

function ipv4Private(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = parts;
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) ||
    a >= 224;
}

/** True for loopback, private, link-local, CGNAT, multicast and other non-public addresses. */
export function isPrivateAddress(address: string): boolean {
  const ip = address.toLowerCase().replace(/^\[|\]$/g, "");
  if (!ip.includes(":")) return ipv4Private(ip);
  const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return ipv4Private(mapped[1]);
  if (ip === "::" || ip === "::1") return true;
  return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(ip) || ip.startsWith("64:ff9b:") || ip.startsWith("2001:db8");
}

async function dnsLookup(hostname: string): Promise<string[]> {
  const [v4, v6] = await Promise.all([
    Deno.resolveDns(hostname, "A").catch(() => [] as string[]),
    Deno.resolveDns(hostname, "AAAA").catch(() => [] as string[]),
  ]);
  return [...v4, ...v6];
}

/**
 * Fetches a public URL. Redirects are followed by hand so every hop is checked: the hostname must be
 * public and must not resolve to an internal address. The body is read up to maxBytes.
 */
export async function fetchPublic(start: string, options: FetchPublicOptions): Promise<FetchedPage> {
  const doFetch = options.fetch ?? fetch;
  const resolve = options.resolve ?? (options.fetch ? null : dnsLookup);
  const maxBytes = options.maxBytes ?? 1_000_000;
  const timeoutMs = Math.max(1, Math.min(options.timeoutMs ?? 8_000, 30_000));
  const signal = AbortSignal.timeout(timeoutMs);
  let url = start;
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      if (!isPublicHttpUrl(url)) return { ok: false, url, status: null, reason: "unsafe_url" };
      if (resolve) {
        const addresses = await resolve(new URL(url).hostname);
        if (!addresses.length) return { ok: false, url, status: null, reason: "network" };
        if (addresses.some(isPrivateAddress)) return { ok: false, url, status: null, reason: "unsafe_url" };
      }
      const response = await doFetch(url, {
        headers: { "User-Agent": USER_AGENT, Accept: options.accept },
        redirect: "manual",
        signal,
      });
      const location = response.headers.get("location");
      if (response.status >= 300 && response.status < 400 && location) {
        await response.body?.cancel();
        url = new URL(location, url).toString();
        continue;
      }
      if (response.status >= 400) {
        await response.body?.cancel();
        return { ok: false, url, status: response.status, reason: "http_error" };
      }
      const body = await readTextCapped(response, maxBytes);
      return { ok: true, url, status: response.status, contentType: response.headers.get("content-type") ?? "", headers: response.headers, body };
    }
    return { ok: false, url, status: null, reason: "too_many_redirects" };
  } catch (error) {
    const timedOut = error instanceof DOMException && (error.name === "TimeoutError" || error.name === "AbortError");
    return { ok: false, url, status: null, reason: timedOut ? "timeout" : "network" };
  }
}
