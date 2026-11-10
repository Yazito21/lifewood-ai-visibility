const BLOCKED_SUFFIXES = [".local", ".internal", ".localhost", ".lan", ".home.arpa"];

/**
 * True for http(s) URLs on public hostnames. Rejects IP literals, single-label hosts
 * (such as "kong" or "localhost") and internal suffixes so the brand website fetch
 * cannot reach the function's own network.
 */
export function isPublicHttpUrl(value: string): boolean {
  let url: URL;
  try { url = new URL(value); } catch { return false; }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  if (url.username || url.password) return false;
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!host || host.startsWith("[") || host.includes(":")) return false;
  if (/^\d+(\.\d+){3}$/.test(host) || /^\d+$/.test(host) || /^0x/i.test(host)) return false;
  if (!host.includes(".")) return false;
  if (BLOCKED_SUFFIXES.some((suffix) => host.endsWith(suffix))) return false;
  return true;
}

/** Reads at most maxBytes of the body as text, then cancels the stream. */
export async function readTextCapped(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < maxBytes) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    const take = value.subarray(0, maxBytes - total);
    chunks.push(take);
    total += take.length;
  }
  await reader.cancel().catch(() => {});
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return new TextDecoder().decode(bytes);
}
