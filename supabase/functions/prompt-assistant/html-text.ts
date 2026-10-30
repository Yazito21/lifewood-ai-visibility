const MIN_USEFUL_CHARS = 200;

const entities: Record<string, string> = {
  "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": "\"", "&#39;": "'", "&apos;": "'", "&nbsp;": " ",
};

function decode(text: string) {
  return text
    .replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/gi, (match) => entities[match.toLowerCase()] ?? match)
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

function clean(text: string) {
  return decode(text).replace(/\s+/g, " ").trim();
}

/**
 * Readable text from a homepage for brand analysis.
 * The title and meta description lead, then the visible body text, trimmed to the character budget.
 * Returns null when the page has too little text to be useful (for example a JavaScript-only shell).
 */
export function htmlToText(html: string, budget = 4000): string | null {
  const title = clean(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "");
  const description = clean(
    html.match(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["']/i)?.[1] ??
      html.match(/<meta[^>]+content=["']([^"']*)["'][^>]*name=["']description["']/i)?.[1] ??
      "",
  );
  const body = clean(
    html
      .replace(/<head[\s\S]*?<\/head>/gi, " ")
      .replace(/<(script|style|noscript|svg|template)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<[^>]+>/g, " "),
  );
  const lead = [title, description].filter(Boolean).map((part) => part.replace(/[.\s]+$/, "") + ".").join(" ");
  const text = [lead, body].filter(Boolean).join(" ").trim();
  if (text.length < MIN_USEFUL_CHARS) return null;
  return text.length > budget ? text.slice(0, budget).replace(/\s+\S*$/, "") : text;
}
