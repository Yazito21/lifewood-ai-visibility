// Streaming raw-response workbook writer.
//
// The export used to hold every response, its raw JSON, a second stringified copy, the chunk sheets and the finished
// XML in memory at once, which exceeded the Edge Function worker's limit once an export covered a few weeks of data.
// This writer fetches responses in small pages and writes each sheet straight into a streaming zip, so memory stays
// flat however many responses are exported. The workbook layout (sheets, columns, chunking) is unchanged.

export type ZipLib = {
  // deno-lint-ignore no-explicit-any
  Zip: new () => any;
  // deno-lint-ignore no-explicit-any
  ZipDeflate: new (name: string, opts?: { level?: number }) => any;
  strToU8: (value: string) => Uint8Array;
};

export type ResponseRow = Record<string, unknown>;
export type PromptRow = { prompt_number?: unknown; prompt?: unknown; topic?: unknown; language?: unknown };

export type ExportSource = {
  /** Pages of responses: "full" has every column, "raw" only id/prompt/captured_at/raw_response. */
  pages: (kind: "full" | "raw") => AsyncIterable<ResponseRow[]>;
  prompts: Map<string, PromptRow>;
};

export type ExportMeta = {
  brandName: string;
  projectId: string;
  trackingLocation: string;
  startDate: string;
  endDate: string;
};

const MAX_CELL = 30000;
const FLUSH_AT = 256 * 1024;
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;

export function splitText(value: string, maxLength = MAX_CELL) {
  if (!value) return [""];
  const parts: string[] = [];
  for (let i = 0; i < value.length; i += maxLength) parts.push(value.slice(i, i + maxLength));
  return parts;
}

export function safeSheetText(value: string) {
  return value.length <= 32767 ? value : value.slice(0, MAX_CELL) + "\n[Truncated in this cell; see the corresponding chunks sheet for the complete value.]";
}

export function extractCitationLinks(raw: unknown, responseText: string) {
  const candidates: Array<{ url: string; title: string; source: string }> = [];
  const payload = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const output = Array.isArray(payload.output) ? payload.output as Array<Record<string, unknown>> : [];
  for (const item of output) {
    if (item.type === "message" && Array.isArray(item.content)) {
      for (const content of item.content as Array<Record<string, unknown>>) {
        if (Array.isArray(content.annotations)) {
          for (const annotation of content.annotations as Array<Record<string, unknown>>) {
            if (annotation.type === "url_citation" && typeof annotation.url === "string") {
              candidates.push({ url: annotation.url, title: String(annotation.title ?? ""), source: "url_citation" });
            }
          }
        }
      }
    }
    if (item.type === "web_search_call" && item.action && typeof item.action === "object") {
      const action = item.action as Record<string, unknown>;
      if (Array.isArray(action.sources)) {
        for (const source of action.sources as Array<Record<string, unknown>>) {
          if (typeof source.url === "string") candidates.push({ url: source.url, title: String(source.title ?? ""), source: "web_search_source" });
        }
      }
    }
  }
  const fallbackUrls = responseText.match(/https?:\/\/[^\s<>"')\]]+/gi) ?? [];
  for (const url of fallbackUrls) candidates.push({ url: url.replace(/[.,;:!?]+$/, ""), title: "", source: "response_text_url" });
  const unique = new Map<string, { url: string; title: string; source: string; domain: string }>();
  for (const candidate of candidates) {
    if (!candidate.url.startsWith("http://") && !candidate.url.startsWith("https://")) continue;
    if (!unique.has(candidate.url)) {
      let domain = "";
      try { domain = new URL(candidate.url).hostname.replace(/^www\./, "").toLowerCase(); } catch { /* invalid URL */ }
      unique.set(candidate.url, { ...candidate, domain });
    }
  }
  return [...unique.values()];
}

function xmlEscape(value: unknown) {
  return String(value ?? "")
    .replace(CONTROL_CHARS, "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function columnName(index: number) {
  let result = "";
  let n = index + 1;
  while (n > 0) {
    const remainder = (n - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    n = Math.floor((n - 1) / 26);
  }
  return result;
}

type Link = { ref: string; id: string; target: string };

function rowXml(rowNumber: number, values: unknown[], linkColumn: number, links: Link[]) {
  let cells = "";
  for (let columnIndex = 0; columnIndex < values.length; columnIndex++) {
    const value = values[columnIndex];
    const ref = columnName(columnIndex) + rowNumber;
    if (typeof value === "number" && Number.isFinite(value)) {
      cells += '<c r="' + ref + '" t="n"><v>' + value + "</v></c>";
      continue;
    }
    const text = String(value ?? "");
    if (columnIndex === linkColumn && rowNumber > 1 && /^https?:\/\/\S+$/i.test(text)) {
      links.push({ ref, id: "rId" + (links.length + 1), target: text });
    }
    cells += '<c r="' + ref + '" t="inlineStr"><is><t xml:space="preserve">' + xmlEscape(text) + "</t></is></c>";
  }
  return '<row r="' + rowNumber + '">' + cells + "</row>";
}

const SHEET_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetData>';

export function streamWorkbook(lib: ZipLib, source: ExportSource, meta: ExportMeta): ReadableStream<Uint8Array> {
  const zip = new lib.Zip();

  async function addEntry(name: string, produce: (write: (text: string) => void) => Promise<void> | void) {
    const file = new lib.ZipDeflate(name, { level: 1 });
    zip.add(file);
    let buffer = "";
    const flush = () => { if (buffer) { file.push(lib.strToU8(buffer), false); buffer = ""; } };
    await produce((text) => { buffer += text; if (buffer.length >= FLUSH_AT) flush(); });
    flush();
    file.push(new Uint8Array(0), true);
  }

  /** One worksheet, streamed. Returns the hyperlinks collected from `linkColumn`. */
  async function addSheet(sheetNumber: number, headers: string[], linkColumn: number, produce: (emit: (values: unknown[]) => void) => Promise<void> | void) {
    const links: Link[] = [];
    await addEntry("xl/worksheets/sheet" + sheetNumber + ".xml", async (write) => {
      write(SHEET_HEAD);
      let rowNumber = 1;
      write(rowXml(rowNumber, headers, -1, links));
      await produce((values) => { rowNumber++; write(rowXml(rowNumber, values, linkColumn, links)); });
      write("</sheetData>");
      if (links.length) write("<hyperlinks>" + links.map((l) => '<hyperlink ref="' + l.ref + '" r:id="' + l.id + '"/>').join("") + "</hyperlinks>");
      write("</worksheet>");
    });
    if (links.length) {
      await addEntry("xl/worksheets/_rels/sheet" + sheetNumber + ".xml.rels", (write) => {
        write('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          links.map((l) => '<Relationship Id="' + l.id + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="' + xmlEscape(l.target) + '" TargetMode="External"/>').join("") +
          "</Relationships>");
      });
    }
  }

  const sheetNames = ["Summary", "Raw Responses", "Citation Links", "Response Text Chunks", "Raw JSON Chunks"];
  const responseHeaders = [
    "Response_ID", "Captured_At", "Tracking_Location", "Run_ID", "Prompt_No", "Prompt_ID", "Prompt", "Topic", "Language", "Engine", "Status", "Error",
    "Response Text (full if <= 30,000 chars)", "Raw Response JSON (full if <= 30,000 chars)", "Response_Text_Characters", "Raw_JSON_Characters",
    "Citation_Count", "Citation_URLs", "Complete Text In Chunks Sheet", "Complete JSON In Chunks Sheet",
  ];
  const citationHeaders = [
    "Response_ID", "Captured_At", "Tracking_Location", "Run_ID", "Prompt_No", "Prompt_ID", "Prompt", "Topic", "Language", "Engine",
    "Citation_Title", "Citation_URL", "Domain", "Citation_Source",
  ];

  async function run() {
    // Pass 1: Raw Responses, streamed. Citation rows and the (rare) oversized text chunks are small and kept for the later sheets.
    const citationRows: unknown[][] = [];
    const textChunkRows: unknown[][] = [];
    let total = 0, completed = 0, failed = 0;
    const distinctPrompts = new Set<string>();
    await addSheet(2, responseHeaders, -1, async (emit) => {
      for await (const page of source.pages("full")) {
        for (const row of page) {
          total++;
          if (row.response_status === "completed") completed++;
          else if (row.response_status === "failed") failed++;
          distinctPrompts.add(String(row.prompt_id ?? ""));
          const prompt = source.prompts.get(String(row.prompt_id ?? ""));
          const text = String(row.response_text ?? "");
          const rawJson = row.raw_response == null ? "" : JSON.stringify(row.raw_response);
          const citations = extractCitationLinks(row.raw_response, text);
          const common = [
            String(row.id ?? ""), String(row.captured_at ?? ""), String(row.tracking_location ?? "LEGACY"), String(row.run_id ?? ""),
            prompt?.prompt_number ?? "", String(row.prompt_id ?? ""), String(row.prompt_snapshot ?? prompt?.prompt ?? ""),
            String(prompt?.topic ?? ""), String(prompt?.language ?? ""), String(row.llm_provider ?? ""),
          ];
          emit([
            ...common, String(row.response_status ?? ""), String(row.error_message ?? ""),
            safeSheetText(text), safeSheetText(rawJson), text.length, rawJson.length,
            citations.length, citations.map((c) => c.url).join("\n"),
            text.length > MAX_CELL ? "Yes" : "No", rawJson.length > MAX_CELL ? "Yes" : "No",
          ]);
          for (const c of citations) citationRows.push([...common, c.title, c.url, c.domain, c.source]);
          if (text.length > MAX_CELL) {
            const chunks = splitText(text);
            chunks.forEach((chunk, index) => textChunkRows.push([String(row.id ?? ""), prompt?.prompt_number ?? "", String(row.captured_at ?? ""), index + 1, chunks.length, chunk]));
          }
        }
      }
    });

    await addSheet(3, citationHeaders, 11, (emit) => { for (const values of citationRows) emit(values); });
    await addSheet(4, ["Response_ID", "Prompt_No", "Captured_At", "Chunk_No", "Total_Chunks", "Response_Text_Chunk"], -1, (emit) => { for (const values of textChunkRows) emit(values); });

    // Pass 2: complete raw JSON for responses whose JSON does not fit in one cell. Only these rows are written.
    await addSheet(5, ["Response_ID", "Prompt_No", "Captured_At", "Chunk_No", "Total_Chunks", "Raw_JSON_Chunk"], -1, async (emit) => {
      for await (const page of source.pages("raw")) {
        for (const row of page) {
          if (row.raw_response == null) continue;
          const rawJson = JSON.stringify(row.raw_response);
          if (rawJson.length <= MAX_CELL) continue;
          const prompt = source.prompts.get(String(row.prompt_id ?? ""));
          const chunks = splitText(rawJson);
          chunks.forEach((chunk, index) => emit([String(row.id ?? ""), prompt?.prompt_number ?? "", String(row.captured_at ?? ""), index + 1, chunks.length, chunk]));
        }
      }
    });

    const summary: unknown[][] = [
      ["Project", meta.brandName], ["Project ID", meta.projectId], ["Tracking Location", meta.trackingLocation],
      ["Period Start (Malaysia Time)", meta.startDate], ["Period End (Malaysia Time)", meta.endDate],
      ["Exported At (UTC)", new Date().toISOString()], ["Total Raw Responses", total], ["Completed Responses", completed],
      ["Failed Responses", failed], ["Other Statuses", total - completed - failed], ["Distinct Prompts", distinctPrompts.size],
      ["Citation Links Extracted From Raw Responses", citationRows.length],
      ["Notes", "Raw Responses includes response text and raw JSON. Values exceeding Excel's cell character limit are complete in the corresponding chunk sheets; reassemble chunks in ascending Chunk_No by Response_ID."],
    ];
    await addSheet(1, ["Field", "Value"], -1, (emit) => { for (const values of summary) emit(values); });

    await addEntry("[Content_Types].xml", (write) => write(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      sheetNames.map((_, i) => '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join("") + "</Types>"));
    await addEntry("_rels/.rels", (write) => write(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'));
    await addEntry("xl/workbook.xml", (write) => write(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
      sheetNames.map((name, i) => '<sheet name="' + xmlEscape(name) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>').join("") + "</sheets></workbook>"));
    await addEntry("xl/_rels/workbook.xml.rels", (write) => write(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      sheetNames.map((_, i) => '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>').join("") + "</Relationships>"));
    zip.end();
  }

  return new ReadableStream<Uint8Array>({
    start(controller) {
      zip.ondata = (error: Error | null, chunk: Uint8Array, final: boolean) => {
        if (error) { controller.error(error); return; }
        controller.enqueue(chunk);
        if (final) controller.close();
      };
      run().catch((error) => controller.error(error));
    },
  });
}
