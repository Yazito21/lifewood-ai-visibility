#!/usr/bin/env python3
"""Clean a Profound raw-response export into the platform's raw response format.

Input : the CSV exported from Profound (one row per prompt x engine x day).
Output: one JSON object per line (JSONL). Each object carries everything the SQL importer needs to
        build ai_responses / tracking_runs rows that the platform's own methodology can analyse:

  profound_run_id   Profound's row id (kept for traceability)
  run_date          capture date (YYYY-MM-DD)
  engine            platform provider id: chatgpt | google_ai_overview | perplexity
  profound_topic    topic label used by Profound (the importer maps topics through the prompt text)
  prompt            prompt text (exact Profound text; the importer matches it to the project's prompts)
  row_seq           order among rows with the same date, engine and prompt (for prompts that appear twice)
  response_status   completed | failed (empty answers are failed, as the platform records them)
  response_text     the answer as the platform stores it: Profound highlight markers removed and,
                    unless --keep-urls is given, link URLs removed (anchor text is kept)
  raw_response      OpenAI-Responses-shaped JSON (output[].content[].annotations[] url_citation),
                    the shape the platform's citation and competitor logic reads, with the original
                    Profound row preserved under "profound"
  cited_urls        distinct cited page URLs in order
  profound_mentioned / profound_position / profound_mentions   Profound's own fields, for validation

Usage: clean_profound_export.py --csv export.csv --out cleaned.jsonl [--keep-urls]
"""
import argparse
import csv
import json
import re
import sys

csv.field_size_limit(10**9)

ENGINES = {
    "ChatGPT": "chatgpt",
    "Google AI Overviews": "google_ai_overview",
    "Perplexity": "perplexity",
}
NON_PAGE_URL = re.compile(r"^https?://(www\.)?google\.[a-z.]+/searchviewer", re.I)
MD_LINK = re.compile(r"\[([^\]]*)\]\((?:<)?https?://[^)\s]+(?:\s+\"[^\"]*\")?(?:>)?\)")
BARE_URL = re.compile(r"https?://[^\s)\]>\"']+")


def clean_text(text: str, keep_urls: bool) -> str:
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = text.replace("==", "")  # Profound highlight markers
    if not keep_urls:
        text = MD_LINK.sub(lambda m: m.group(1), text)
        text = re.sub(r"\(\s*" + BARE_URL.pattern + r"\s*\)", "", text)
        text = BARE_URL.sub("", text)
        text = re.sub(r"\(\s*\)", "", text)
        text = re.sub(r"[ \t]{2,}", " ", text)
        text = re.sub(r" +([,.;:])", r"\1", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--csv", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--keep-urls", action="store_true", help="keep link URLs inside response_text")
    ap.add_argument("--keep-original", action="store_true", help="embed Profound's untouched answer text in raw_response.profound (doubles the size)")
    args = ap.parse_args()

    seq: dict = {}
    stats = {"rows": 0, "failed": 0, "unknown_engine": 0, "urls": 0, "dropped_non_page_urls": 0}
    with open(args.csv, newline="", encoding="utf-8-sig") as src, open(args.out, "w", encoding="utf-8") as out:
        for row in csv.DictReader(src):
            stats["rows"] += 1
            engine = ENGINES.get(row["platform"])
            if engine is None:
                stats["unknown_engine"] += 1
                continue
            original = row["response"] or ""
            text = clean_text(original, args.keep_urls)
            urls, seen = [], set()
            for i in range(1, 41):
                url = (row.get(f"citation_{i}") or "").strip()
                if not url:
                    continue
                if NON_PAGE_URL.match(url):
                    stats["dropped_non_page_urls"] += 1
                    continue
                if url not in seen:
                    seen.add(url)
                    urls.append(url)
            stats["urls"] += len(urls)
            status = "completed" if text else "failed"
            stats["failed"] += status == "failed"
            key = (row["date"], engine, row["prompt"])
            seq[key] = seq.get(key, 0) + 1
            mentions = [m.strip() for m in (row.get("mentions") or "").split(",") if m.strip()]
            position = re.sub(r"[^0-9]", "", row.get("position") or "")
            raw = {
                "object": "response",
                "status": "completed" if status == "completed" else "failed",
                "output": [{
                    "type": "message", "role": "assistant", "status": "completed",
                    "content": [{
                        "type": "output_text", "text": text,
                        "annotations": [{"type": "url_citation", "url": u, "title": None} for u in urls],
                    }],
                }],
                "profound": {
                    "run_id": row["run_id"], "platform": row["platform"], "platform_id": row["platformId"],
                    "topic": row["topic"], "region": row["region"], "persona": row["persona"], "tags": row["tags"],
                    "mentions": mentions, "position": row["position"], "mentioned": row["mentioned?"],
                    "search_queries": row["search_queries"],
                },
                "source": "profound_import",
            }
            if args.keep_original:
                raw["profound"]["original_response"] = original
            out.write(json.dumps({
                "profound_run_id": row["run_id"], "run_date": row["date"], "engine": engine,
                "profound_topic": row["topic"], "prompt": row["prompt"], "row_seq": seq[key],
                "response_status": status, "response_text": text, "raw_response": raw, "cited_urls": urls,
                "profound_mentioned": row["mentioned?"] == "Yes",
                "profound_position": int(position) if position else None,
                "profound_mentions": mentions,
            }, ensure_ascii=False) + "\n")
    json.dump(stats, sys.stderr)
    sys.stderr.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
