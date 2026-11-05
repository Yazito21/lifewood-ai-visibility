import { isPublicHttpUrl, readTextCapped } from "./url-guard.ts";

export type FetchFailure = "unsafe_url" | "timeout" | "network" | "too_many_redirects" | "http_error";

export type FetchedPage =
  | { ok: true; url: string; status: number; contentType: string; headers: Headers; body: string }
  | { ok: false; url: string; status: number | null; reason: FetchFailure };

export type FetchPublicOptions = { accept: string; maxBytes?: number; timeoutMs?: number; fetch?: typeof fetch };

const MAX_REDIRECTS = 3;
export const USER_AGENT = "LifewoodAIVisibilityBot/1.0";

/**
 * Fetches a public URL. Redirects are followed by hand so every hop is checked against
 * internal addresses; the body is read up to maxBytes.
 */
export async function fetchPublic(start: string, options: FetchPublicOptions): Promise<FetchedPage> {
  const doFetch = options.fetch ?? fetch;
  const maxBytes = options.maxBytes ?? 1_000_000;
  const signal = AbortSignal.timeout(options.timeoutMs ?? 8_000);
  let url = start;
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      if (!isPublicHttpUrl(url)) return { ok: false, url, status: null, reason: "unsafe_url" };
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
