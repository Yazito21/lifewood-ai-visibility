// Port of score_passage / analyze_page_citability from geo-seo-claude scripts/citability_scorer.py (MIT).
// Point values, patterns and thresholds are kept identical to the Python original.

export type PassageScore = {
  total: number;
  answerBlock: number;
  selfContainment: number;
  structure: number;
  statistics: number;
  uniqueness: number;
};

export type CitablePassage = { heading: string | null; text: string; score: number };

export type PageCitability = { score: number; passages: number; best: CitablePassage[]; worst: CitablePassage[] };

const DEFINITION_PATTERNS = [
  /\b\w+\s+is\s+(?:a|an|the)\s/i,
  /\b\w+\s+refers?\s+to\s/i,
  /\b\w+\s+means?\s/i,
  /\b\w+\s+(?:can be |are )?defined\s+as\s/i,
  /\bin\s+(?:simple|other)\s+(?:terms|words)\s*,/i,
];
const EARLY_ANSWER_PATTERNS = [/\b(?:is|are|was|were|means?|refers?)\b/i, /\d+%/i, /\$[\d,]+/i, /\d+\s+(?:million|billion|thousand)/i];
const SOURCE_PATTERNS = [
  /(?:according to|per|from|by)\s+[A-Z]/,
  /(?:Gartner|Forrester|McKinsey|Harvard|Stanford|MIT|Google|Microsoft|OpenAI|Anthropic)/,
  /\([A-Z][a-z]+(?:\s+\d{4})?\)/,
];

const words = (text: string) => text.split(/\s+/).filter(Boolean);
const count = (text: string, pattern: RegExp) => (text.match(pattern) ?? []).length;

export function scorePassage(text: string, heading: string | null = null): PassageScore {
  const wordList = words(text);
  const wordCount = wordList.length;

  // 1. Answer block quality (max 30)
  let abq = 0;
  if (DEFINITION_PATTERNS.some((p) => p.test(text))) abq += 15;
  const first60 = wordList.slice(0, 60).join(" ");
  if (EARLY_ANSWER_PATTERNS.some((p) => p.test(first60))) abq += 15;
  if (heading && heading.endsWith("?")) abq += 10;
  const sentences = text.split(/[.!?]+/);
  const shortClear = sentences.filter((s) => {
    const n = words(s).length;
    return n >= 5 && n <= 25;
  }).length;
  if (sentences.length) abq += Math.floor((shortClear / sentences.length) * 10);
  if (/(?:according to|research shows|studies? (?:show|indicate|suggest|found)|data (?:shows|indicates|suggests))/i.test(text)) abq += 10;
  const answerBlock = Math.min(abq, 30);

  // 2. Self-containment (max 25)
  let sc = 0;
  if (wordCount >= 134 && wordCount <= 167) sc += 10;
  else if (wordCount >= 100 && wordCount <= 200) sc += 7;
  else if (wordCount >= 80 && wordCount <= 250) sc += 4;
  else if (wordCount < 30 || wordCount > 400) sc += 0;
  else sc += 2;
  const pronouns = count(text, /\b(?:it|they|them|their|this|that|these|those|he|she|his|her)\b/gi);
  if (wordCount > 0) {
    const ratio = pronouns / wordCount;
    if (ratio < 0.02) sc += 8;
    else if (ratio < 0.04) sc += 5;
    else if (ratio < 0.06) sc += 3;
  }
  const properNouns = count(text, /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/g);
  if (properNouns >= 3) sc += 7;
  else if (properNouns >= 1) sc += 4;
  const selfContainment = Math.min(sc, 25);

  // 3. Structural readability (max 20)
  let sr = 0;
  if (sentences.length) {
    const avg = wordCount / sentences.length;
    if (avg >= 10 && avg <= 20) sr += 8;
    else if (avg >= 8 && avg <= 25) sr += 5;
    else sr += 2;
  }
  if (/(?:first|second|third|finally|additionally|moreover|furthermore)/i.test(text)) sr += 4;
  if (/(?:\d+[.)]\s|\b(?:step|tip|point)\s+\d+)/i.test(text)) sr += 4;
  if (text.includes("\n")) sr += 4;
  const structure = Math.min(sr, 20);

  // 4. Statistical density (max 15)
  let sd = 0;
  sd += Math.min(count(text, /\d+(?:\.\d+)?%/g) * 3, 6);
  sd += Math.min(count(text, /\$[\d,]+(?:\.\d+)?(?:\s*(?:million|billion|M|B|K))?/g) * 3, 5);
  sd += Math.min(count(text, /\b\d+(?:,\d{3})*(?:\.\d+)?\s+(?:users|customers|pages|sites|companies|businesses|people|percent|times|x\b)/gi) * 2, 4);
  if (/\b20(?:2[3-6]|1\d)\b/.test(text)) sd += 2;
  for (const pattern of SOURCE_PATTERNS) if (pattern.test(text)) sd += 2;
  const statistics = Math.min(sd, 15);

  // 5. Uniqueness signals (max 10)
  let us = 0;
  if (/(?:our (?:research|study|data|analysis|survey|findings)|we (?:found|discovered|analyzed|surveyed|measured))/i.test(text)) us += 5;
  if (/(?:case study|for example|for instance|in practice|real-world|hands-on)/i.test(text)) us += 3;
  if (/(?:using|with|via|through)\s+[A-Z][a-z]+/.test(text)) us += 2;
  const uniqueness = Math.min(us, 10);

  return { total: answerBlock + selfContainment + structure + statistics + uniqueness, answerBlock, selfContainment, structure, statistics, uniqueness };
}

function textOf(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&").replace(/&nbsp;/g, " ").replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, "\"")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

/** Content blocks under each heading (non-content elements removed), each scored for citability. */
export function scorePageCitability(html: string): PageCitability {
  const cleaned = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|nav|footer|header|aside|form)\b[\s\S]*?<\/\1>/gi, " ");
  const blocks: { heading: string; content: string }[] = [];
  let heading = "Introduction";
  let paragraphs: string[] = [];
  const flush = () => {
    const combined = paragraphs.join(" ");
    if (paragraphs.length && words(combined).length >= 20) blocks.push({ heading, content: combined });
    paragraphs = [];
  };
  for (const match of cleaned.matchAll(/<(h[1-4]|p|ul|ol|table)\b[^>]*>([\s\S]*?)<\/\1>/gi)) {
    const text = textOf(match[2]);
    if (match[1].toLowerCase().startsWith("h")) {
      flush();
      heading = text;
    } else if (text && words(text).length >= 5) {
      paragraphs.push(text);
    }
  }
  flush();

  const scored = blocks.map((block) => ({ heading: block.heading, text: block.content, score: scorePassage(block.content, block.heading).total }));
  if (!scored.length) return { score: 0, passages: 0, best: [], worst: [] };
  const trim = (p: CitablePassage): CitablePassage => ({ ...p, text: p.text.length > 300 ? p.text.slice(0, 297) + "..." : p.text });
  const byScore = [...scored].sort((a, b) => b.score - a.score);
  return {
    score: Math.round(scored.reduce((sum, p) => sum + p.score, 0) / scored.length),
    passages: scored.length,
    best: byScore.slice(0, 3).map(trim),
    worst: [...byScore].reverse().slice(0, 3).map(trim),
  };
}
