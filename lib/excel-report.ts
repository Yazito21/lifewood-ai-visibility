// Shared Excel report builder for the platform pages.
//
// Cells, styles and layout are written with ExcelJS. ExcelJS cannot create charts,
// so each native Excel line chart is described here and injected into the saved
// package (drawing + chart parts) with JSZip. Every chart reads straight from the
// worksheet cells next to it, so the workbook stays editable and self-contained.
import type { Workbook, Worksheet, Fill, Border, Style } from "exceljs";

export const THEME = {
  green: "046241",
  dark: "133020",
  soft: "EEF4EF",
  band: "F6F9F7",
  line: "D5DFD8",
  muted: "66736C",
  orange: "FFB347",
  orangeDark: "B86E00",
  white: "FFFFFF",
  good: "0B7A4B",
  bad: "B42318",
} as const;

const FONT = "Calibri";
const DATE_FMT = "dd mmm yyyy";
const FMT = {
  text: "@",
  int: "#,##0",
  pct: '0.0"%"',
  rank: "0",
  decimal: "0.0",
  date: DATE_FMT,
} as const;

export type ColumnType = keyof typeof FMT | "link";
export type ReportColumn = {
  header: string;
  type?: ColumnType;
  /** Width in characters; the widest value wins for text columns when omitted. */
  width?: number;
  align?: "left" | "center" | "right";
  /** Shown for null/undefined values. Chart data tables use "" so the cell stays empty. */
  empty?: string;
};
export type CellValue = string | number | Date | null | undefined | { text: string; hyperlink: string };

export type SeriesKind = "score" | "rank";
export type TrendSeries = {
  header: string;
  kind: SeriesKind;
  values: Array<number | null>;
  chartTitle: string;
  yTitle: string;
  /** Decimals shown for rank values in cells and on chart hover (Analytics means use 1). */
  decimals?: number;
  color?: string;
};

type ChartSpec = {
  title: string;
  kind: SeriesKind;
  yTitle: string;
  xTitle: string;
  sheetName: string;
  dateRef: string;
  valueRef: string;
  headerRef: string;
  header: string;
  dates: Date[];
  values: Array<number | null>;
  decimals: number;
  color: string;
  col: number;
  row: number;
  widthPx: number;
  heightPx: number;
};

const CHART_W = 560;
const CHART_H = 320;
const ROW_PX = 20;

const thin = (color: string): Partial<Border> => ({ style: "thin", color: { argb: "FF" + color } });
const box = (color: string): Style["border"] => ({ top: thin(color), left: thin(color), bottom: thin(color), right: thin(color) });
const solid = (hex: string): Fill => ({ type: "pattern", pattern: "solid", fgColor: { argb: "FF" + hex } });

function toDate(value: string) {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
export const excelDate = toDate;
const serial = (date: Date) => 25569 + date.getTime() / 86400000;
const esc = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const colLetter = (index: number) => {
  let n = index + 1, out = "";
  while (n > 0) { const r = (n - 1) % 26; out = String.fromCharCode(65 + r) + out; n = Math.floor((n - 1) / 26); }
  return out;
};
const quoteSheet = (name: string) => "'" + name.replace(/'/g, "''") + "'";

/** Excel sheet names: max 31 chars, none of : \ / ? * [ ] */
export function safeSheetName(name: string) {
  return name.replace(/[:\\/?*[\]]/g, " ").replace(/\s+/g, " ").trim().slice(0, 31) || "Sheet";
}
export function safeFileName(value: string) {
  return value.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "report";
}

export class SheetWriter {
  ws: Worksheet;
  row = 1;
  private charts: ChartSpec[] = [];
  private widths: number[];
  constructor(ws: Worksheet, widths: number[]) {
    this.ws = ws;
    this.widths = widths;
    widths.forEach((width, i) => { ws.getColumn(i + 1).width = width; });
    ws.properties.defaultRowHeight = 15;
  }
  get chartSpecs() { return this.charts; }
  get lastColumn() { return this.widths.length; }

  /** Dark title banner with a subtitle line underneath. */
  banner(title: string, subtitle: string) {
    const last = this.lastColumn;
    this.ws.mergeCells(this.row, 1, this.row, last);
    const t = this.ws.getCell(this.row, 1);
    t.value = title;
    t.font = { name: FONT, size: 18, bold: true, color: { argb: "FF" + THEME.white } };
    t.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
    for (let c = 1; c <= last; c++) this.ws.getCell(this.row, c).fill = solid(THEME.green);
    this.ws.getRow(this.row).height = 36;
    this.row++;
    this.ws.mergeCells(this.row, 1, this.row, last);
    const s = this.ws.getCell(this.row, 1);
    s.value = subtitle;
    s.font = { name: FONT, size: 11, color: { argb: "FF" + THEME.dark } };
    s.alignment = { vertical: "middle", horizontal: "left", indent: 1, wrapText: true };
    for (let c = 1; c <= last; c++) this.ws.getCell(this.row, c).fill = solid(THEME.soft);
    this.ws.getRow(this.row).height = 22;
    this.row += 2;
  }

  /** Label/value pairs, used for the filters that produced the data. */
  keyValues(pairs: Array<[string, string]>, labelSpan = 2) {
    for (const [label, value] of pairs) {
      if (labelSpan > 1) this.ws.mergeCells(this.row, 1, this.row, labelSpan);
      const l = this.ws.getCell(this.row, 1);
      l.value = label;
      l.font = { name: FONT, size: 11, bold: true, color: { argb: "FF" + THEME.dark } };
      l.fill = solid(THEME.soft);
      l.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
      l.border = box(THEME.line);
      if (labelSpan > 1) for (let c = 2; c <= labelSpan; c++) { this.ws.getCell(this.row, c).fill = solid(THEME.soft); this.ws.getCell(this.row, c).border = box(THEME.line); }
      const valueEnd = Math.min(this.lastColumn, Math.max(labelSpan + 4, labelSpan + 1));
      this.ws.mergeCells(this.row, labelSpan + 1, this.row, valueEnd);
      const v = this.ws.getCell(this.row, labelSpan + 1);
      v.value = value;
      v.font = { name: FONT, size: 11, color: { argb: "FF" + THEME.dark } };
      v.alignment = { vertical: "middle", horizontal: "left", indent: 1, wrapText: true };
      for (let c = labelSpan + 1; c <= valueEnd; c++) this.ws.getCell(this.row, c).border = box(THEME.line);
      if (value.length > 70) this.ws.getRow(this.row).height = 15 * Math.ceil(value.length / 70);
      this.row++;
    }
    this.row++;
  }

  /** Section heading with a one-line description. */
  section(title: string, description?: string) {
    const last = this.lastColumn;
    this.ws.mergeCells(this.row, 1, this.row, last);
    const t = this.ws.getCell(this.row, 1);
    t.value = title;
    t.font = { name: FONT, size: 14, bold: true, color: { argb: "FF" + THEME.green } };
    t.alignment = { vertical: "middle", horizontal: "left" };
    for (let c = 1; c <= last; c++) this.ws.getCell(this.row, c).border = { bottom: { style: "medium", color: { argb: "FF" + THEME.green } } };
    this.ws.getRow(this.row).height = 24;
    this.row++;
    if (description) {
      this.ws.mergeCells(this.row, 1, this.row, last);
      const d = this.ws.getCell(this.row, 1);
      d.value = description;
      d.font = { name: FONT, size: 10, italic: true, color: { argb: "FF" + THEME.muted } };
      d.alignment = { vertical: "middle", horizontal: "left", wrapText: true };
      this.ws.getRow(this.row).height = description.length > 140 ? 30 : 18;
      this.row++;
    }
    this.row++;
  }

  note(text: string) {
    this.ws.mergeCells(this.row, 1, this.row, this.lastColumn);
    const c = this.ws.getCell(this.row, 1);
    c.value = text;
    c.font = { name: FONT, size: 10, italic: true, color: { argb: "FF" + THEME.muted } };
    c.alignment = { vertical: "middle", horizontal: "left", wrapText: true };
    this.ws.getRow(this.row).height = text.length > 140 ? 30 : 18;
    this.row += 2;
  }

  gap(rows = 1) { this.row += rows; }

  /**
   * Styled table. Returns the header row and the first/last data rows (1-based) so charts and
   * formulas can reference the cells.
   */
  table(columns: ReportColumn[], rows: CellValue[][], opts: { startColumn?: number; autoFilter?: boolean; emphasizeRow?: (row: CellValue[], index: number) => boolean } = {}) {
    const start = opts.startColumn ?? 1;
    const headerRow = this.row;
    columns.forEach((column, i) => {
      const cell = this.ws.getCell(headerRow, start + i);
      cell.value = column.header;
      cell.font = { name: FONT, size: 11, bold: true, color: { argb: "FF" + THEME.white } };
      cell.fill = solid(THEME.green);
      cell.alignment = { vertical: "middle", horizontal: column.align ?? (column.type && column.type !== "text" && column.type !== "link" ? "right" : "left"), wrapText: true, indent: 1 };
      cell.border = box(THEME.green);
    });
    this.ws.getRow(headerRow).height = 30;
    rows.forEach((values, r) => {
      const rowIndex = headerRow + 1 + r;
      const emphasized = opts.emphasizeRow?.(values, r) ?? false;
      columns.forEach((column, i) => {
        const cell = this.ws.getCell(rowIndex, start + i);
        const type = column.type ?? "text";
        const raw = values[i];
        const missing = raw === null || raw === undefined || (typeof raw === "number" && !Number.isFinite(raw));
        if (missing) cell.value = column.empty ?? "N/A";
        else cell.value = raw as never;
        cell.font = { name: FONT, size: 11, bold: emphasized, color: { argb: "FF" + THEME.dark } };
        if (type === "link" && !missing && typeof raw === "object" && raw && "hyperlink" in raw) cell.font = { name: FONT, size: 11, underline: true, color: { argb: "FF" + THEME.green } };
        cell.border = box(THEME.line);
        const numeric = type !== "text" && type !== "link";
        cell.alignment = { vertical: "middle", horizontal: column.align ?? (numeric && !missing ? "right" : missing && numeric ? "right" : "left"), indent: 1, wrapText: type === "text" };
        if (numeric && !missing) cell.numFmt = FMT[type as keyof typeof FMT];
        if (emphasized) cell.fill = solid("FFF3DB");
        else if (r % 2 === 1) cell.fill = solid(THEME.band);
      });
    });
    const lastRow = headerRow + rows.length;
    if (opts.autoFilter && rows.length) {
      this.ws.autoFilter = { from: { row: headerRow, column: start }, to: { row: lastRow, column: start + columns.length - 1 } };
    }
    this.row = lastRow + 2;
    return { headerRow, firstRow: headerRow + 1, lastRow };
  }

  /**
   * A day-by-day data table with one native line chart per series stacked to its right.
   * Dates with no recorded value are simply absent; the chart bridges them like the platform does.
   */
  trendBlock(opts: { heading: string; description: string; dateHeader?: string; dates: string[]; series: TrendSeries[]; extraColumns?: Array<{ column: ReportColumn; values: CellValue[] }>; emptyMessage?: string }) {
    this.section(opts.heading, opts.description);
    const extras = opts.extraColumns ?? [];
    const order = opts.dates.map((_, i) => i).sort((a, b) => opts.dates[a].localeCompare(opts.dates[b]));
    const hasData = opts.series.some((s) => s.values.some((v) => v !== null && Number.isFinite(v)));
    if (!opts.dates.length || !hasData) {
      this.note(opts.emptyMessage ?? "No recorded values for the selected filters.");
      return;
    }
    const columns: ReportColumn[] = [
      { header: opts.dateHeader ?? "Date", type: "date", align: "left" },
      ...opts.series.map((s): ReportColumn => ({ header: s.header, type: s.kind === "score" ? "pct" : (s.decimals ?? 0) > 0 ? "decimal" : "rank", empty: "" })),
      ...extras.map((e) => e.column),
    ];
    const rows = order.map((i) => [excelDate(opts.dates[i]), ...opts.series.map((s) => s.values[i] ?? null), ...extras.map((e) => e.values[i] ?? null)] as CellValue[]);
    const { headerRow, firstRow, lastRow } = this.table(columns, rows);
    // Hover numbers on rank cells follow the requested decimals.
    opts.series.forEach((s, si) => {
      if (s.kind === "rank") for (let r = firstRow; r <= lastRow; r++) this.ws.getCell(r, 2 + si).numFmt = (s.decimals ?? 0) > 0 ? "0." + "0".repeat(s.decimals ?? 0) : "0";
    });
    const chartColumn = columns.length + 1; // one blank spacer column, zero-based index === columns.length + 1
    const dates = order.map((i) => toDate(opts.dates[i]));
    const sheetName = this.ws.name;
    opts.series.forEach((s, si) => {
      const valueCol = colLetter(1 + si);
      const top = headerRow - 1 + si * Math.ceil(CHART_H / ROW_PX + 1);
      this.charts.push({
        title: s.chartTitle,
        kind: s.kind,
        yTitle: s.yTitle,
        xTitle: "Tracking date",
        sheetName,
        dateRef: quoteSheet(sheetName) + "!$A$" + firstRow + ":$A$" + lastRow,
        valueRef: quoteSheet(sheetName) + "!$" + valueCol + "$" + firstRow + ":$" + valueCol + "$" + lastRow,
        headerRef: quoteSheet(sheetName) + "!$" + valueCol + "$" + headerRow,
        header: s.header,
        dates,
        values: order.map((i) => s.values[i] ?? null),
        decimals: s.decimals ?? 0,
        color: s.color ?? THEME.green,
        col: chartColumn,
        row: Math.max(top, 0),
        widthPx: CHART_W,
        heightPx: CHART_H,
      });
    });
    const chartRows = opts.series.length * Math.ceil(CHART_H / ROW_PX + 1);
    const tableEnd = lastRow + 2;
    this.row = Math.max(tableEnd, headerRow + chartRows) + 1;
  }
}

export class ReportBuilder {
  private sheets: SheetWriter[] = [];
  private wb: Workbook;
  private constructor(wb: Workbook) { this.wb = wb; }

  static async create(meta: { title: string; subject?: string }) {
    const mod = await import("exceljs");
    const ExcelJS = (mod as unknown as { default?: typeof import("exceljs") }).default ?? mod;
    const wb = new ExcelJS.Workbook();
    wb.creator = "Lifewood AI Visibility";
    wb.title = meta.title;
    if (meta.subject) wb.subject = meta.subject;
    wb.created = new Date();
    return new ReportBuilder(wb);
  }

  addSheet(name: string, widths: number[], opts: { gridlines?: boolean; tab?: string; landscape?: boolean } = {}) {
    const ws = this.wb.addWorksheet(safeSheetName(name), {
      views: [{ showGridLines: opts.gridlines ?? false }],
      properties: { tabColor: { argb: "FF" + (opts.tab ?? THEME.green) } },
      pageSetup: { orientation: opts.landscape === false ? "portrait" : "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 },
    });
    const writer = new SheetWriter(ws, widths);
    this.sheets.push(writer);
    return writer;
  }

  /** Freezes everything above and including `row` so table headers stay visible. */
  freeze(sheet: SheetWriter, row: number) {
    sheet.ws.views = [{ state: "frozen", ySplit: row, showGridLines: false }];
  }

  async toBuffer(): Promise<Uint8Array> {
    const raw = await this.wb.xlsx.writeBuffer();
    const withCharts = this.sheets.filter((s) => s.chartSpecs.length > 0);
    if (!withCharts.length) return new Uint8Array(raw as ArrayBuffer);
    const { default: JSZip } = await import("jszip");
    const zip = await JSZip.loadAsync(raw as ArrayBuffer);
    let chartNo = 0, drawingNo = 0;
    const contentTypes: string[] = [];
    for (const sheet of withCharts) {
      drawingNo++;
      const sheetFile = "xl/worksheets/sheet" + sheet.ws.id + ".xml";
      const relsFile = "xl/worksheets/_rels/sheet" + sheet.ws.id + ".xml.rels";
      const sheetXml = await zip.file(sheetFile)!.async("string");
      const drawingRid = "rIdDrawing" + drawingNo;
      let patched = sheetXml;
      const tag = '<drawing r:id="' + drawingRid + '"/>';
      const anchorBefore = ["<tableParts", "<extLst", "</worksheet>"].map((t) => patched.indexOf(t)).filter((i) => i >= 0).sort((a, b) => a - b)[0];
      patched = patched.slice(0, anchorBefore) + tag + patched.slice(anchorBefore);
      zip.file(sheetFile, patched);
      const relEntry = '<Relationship Id="' + drawingRid + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing' + drawingNo + '.xml"/>';
      const existingRels = zip.file(relsFile);
      if (existingRels) {
        const xml = await existingRels.async("string");
        zip.file(relsFile, xml.replace("</Relationships>", relEntry + "</Relationships>"));
      } else {
        zip.file(relsFile, '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + relEntry + "</Relationships>");
      }
      const drawingRels: string[] = [];
      const anchors = sheet.chartSpecs.map((spec, i) => {
        chartNo++;
        const rid = "rId" + (i + 1);
        drawingRels.push('<Relationship Id="' + rid + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart' + chartNo + '.xml"/>');
        zip.file("xl/charts/chart" + chartNo + ".xml", lineChartXml(spec));
        contentTypes.push('<Override PartName="/xl/charts/chart' + chartNo + '.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>');
        return anchorXml(spec, i + 1, rid);
      });
      zip.file("xl/drawings/drawing" + drawingNo + ".xml",
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart">' + anchors.join("") + "</xdr:wsDr>");
      zip.file("xl/drawings/_rels/drawing" + drawingNo + ".xml.rels",
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + drawingRels.join("") + "</Relationships>");
      contentTypes.push('<Override PartName="/xl/drawings/drawing' + drawingNo + '.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>');
    }
    const ctXml = await zip.file("[Content_Types].xml")!.async("string");
    zip.file("[Content_Types].xml", ctXml.replace("</Types>", contentTypes.join("") + "</Types>"));
    return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  }
}

function anchorXml(spec: ChartSpec, id: number, rid: string) {
  const emu = (px: number) => Math.round(px * 9525);
  return '<xdr:oneCellAnchor><xdr:from><xdr:col>' + spec.col + '</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>' + spec.row + '</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>' +
    '<xdr:ext cx="' + emu(spec.widthPx) + '" cy="' + emu(spec.heightPx) + '"/>' +
    '<xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="' + (id + 1) + '" name="Chart ' + id + '" descr="' + esc(spec.title) + '"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr>' +
    '<xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart r:id="' + rid + '"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:oneCellAnchor>';
}

const textProps = (size: number, bold = false, color: string = THEME.dark) =>
  '<a:defRPr sz="' + size + '" b="' + (bold ? 1 : 0) + '"><a:solidFill><a:srgbClr val="' + color + '"/></a:solidFill><a:latin typeface="' + FONT + '"/></a:defRPr>';
const txPr = (size: number, bold = false, color: string = THEME.muted) =>
  '<c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr>' + textProps(size, bold, color) + '</a:pPr><a:endParaRPr lang="en-US"/></a:p></c:txPr>';
const richTitle = (text: string, size: number, rotate = false) =>
  '<c:title><c:tx><c:rich><a:bodyPr' + (rotate ? ' rot="-5400000" vert="horz"' : "") + '/><a:lstStyle/><a:p><a:pPr>' + textProps(size, true) + '</a:pPr><a:r><a:rPr lang="en-US" sz="' + size + '" b="1"><a:solidFill><a:srgbClr val="' + THEME.dark + '"/></a:solidFill><a:latin typeface="' + FONT + '"/></a:rPr><a:t>' + esc(text) + '</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title>';
const lineProps = (color: string, w: number, dash?: string) =>
  '<c:spPr><a:ln w="' + w + '"><a:solidFill><a:srgbClr val="' + color + '"/></a:solidFill>' + (dash ? '<a:prstDash val="' + dash + '"/>' : "") + "</a:ln></c:spPr>";

/** Fixed score axis: labelled every 5, minor marks every 2.5. Rank axis: whole ranks, 1 (best) at the top. */
export function valueAxisBounds(kind: SeriesKind, values: Array<number | null>) {
  const valid = values.filter((v): v is number => v !== null && Number.isFinite(v));
  const rawMax = valid.length ? Math.max(...valid) : 0;
  if (kind === "score") return { min: 0, max: Math.max(5, Math.ceil(rawMax / 5) * 5), major: 5, minor: 2.5 };
  const rankMax = Math.max(2, Math.ceil(rawMax));
  // Above 25 the axis is labelled every 5 ranks (Excel counts from the axis minimum, so it starts at 0 there).
  if (rankMax > 25) return { min: 0, max: Math.ceil(rankMax / 5) * 5, major: 5, minor: 0 };
  return { min: 1, max: rankMax, major: 1, minor: 0 };
}

export function lineChartXml(spec: ChartSpec) {
  const bounds = valueAxisBounds(spec.kind, spec.values);
  const valueFormat = spec.kind === "score" ? '0.0"%"' : spec.decimals > 0 ? "0." + "0".repeat(spec.decimals) : "0";
  const axisFormat = spec.kind === "score" ? '0.0"%"' : "0";
  const dateCache = spec.dates.map((d, i) => '<c:pt idx="' + i + '"><c:v>' + serial(d) + "</c:v></c:pt>").join("");
  const valueCache = spec.values.map((v, i) => (v === null || !Number.isFinite(v) ? "" : '<c:pt idx="' + i + '"><c:v>' + v + "</c:v></c:pt>")).join("");
  const reversed = spec.kind === "rank";
  const marker = '<c:marker><c:symbol val="circle"/><c:size val="7"/><c:spPr><a:solidFill><a:srgbClr val="' + spec.color + '"/></a:solidFill><a:ln w="12700"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:ln></c:spPr></c:marker>';
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<c:date1904 val="0"/><c:roundedCorners val="0"/><c:chart>' + richTitle(spec.title, 1300) + '<c:autoTitleDeleted val="0"/><c:plotArea><c:layout/>' +
    '<c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/><c:ser><c:idx val="0"/><c:order val="0"/>' +
    '<c:tx><c:strRef><c:f>' + esc(spec.headerRef) + '</c:f><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>' + esc(spec.header) + '</c:v></c:pt></c:strCache></c:strRef></c:tx>' +
    '<c:spPr><a:ln w="31750" cap="rnd"><a:solidFill><a:srgbClr val="' + spec.color + '"/></a:solidFill><a:round/></a:ln></c:spPr>' + marker +
    '<c:cat><c:numRef><c:f>' + esc(spec.dateRef) + '</c:f><c:numCache><c:formatCode>' + DATE_FMT + '</c:formatCode><c:ptCount val="' + spec.dates.length + '"/>' + dateCache + '</c:numCache></c:numRef></c:cat>' +
    '<c:val><c:numRef><c:f>' + esc(spec.valueRef) + '</c:f><c:numCache><c:formatCode>' + esc(valueFormat) + '</c:formatCode><c:ptCount val="' + spec.values.length + '"/>' + valueCache + '</c:numCache></c:numRef></c:val>' +
    '<c:smooth val="0"/></c:ser><c:marker val="1"/><c:axId val="50010"/><c:axId val="50020"/></c:lineChart>' +
    '<c:dateAx><c:axId val="50010"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/>' + richTitle(spec.xTitle, 1000) +
    '<c:numFmt formatCode="d mmm" sourceLinked="0"/><c:majorTickMark val="out"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/>' + lineProps("8A9690", 12700) + txPr(900) +
    '<c:crossAx val="50020"/><c:crosses val="' + (reversed ? "max" : "autoZero") + '"/><c:auto val="0"/><c:lblOffset val="100"/><c:baseTimeUnit val="days"/></c:dateAx>' +
    '<c:valAx><c:axId val="50020"/><c:scaling><c:orientation val="' + (reversed ? "maxMin" : "minMax") + '"/><c:max val="' + bounds.max + '"/><c:min val="' + bounds.min + '"/></c:scaling><c:delete val="0"/><c:axPos val="l"/>' +
    '<c:majorGridlines>' + lineProps("C9D3CD", 9525, "dash") + '</c:majorGridlines>' +
    (bounds.minor ? '<c:minorGridlines>' + lineProps("E4EAE6", 6350, "sysDot") + '</c:minorGridlines>' : "") +
    richTitle(spec.yTitle, 1000, true) +
    '<c:numFmt formatCode="' + esc(axisFormat) + '" sourceLinked="0"/><c:majorTickMark val="out"/><c:minorTickMark val="' + (bounds.minor ? "out" : "none") + '"/><c:tickLblPos val="nextTo"/>' + lineProps("8A9690", 12700) + txPr(900) +
    '<c:crossAx val="50010"/><c:crosses val="autoZero"/><c:crossBetween val="between"/><c:majorUnit val="' + bounds.major + '"/>' + (bounds.minor ? '<c:minorUnit val="' + bounds.minor + '"/>' : "") + '</c:valAx>' +
    '<c:spPr><a:noFill/></c:spPr></c:plotArea><c:plotVisOnly val="1"/><c:dispBlanksAs val="span"/></c:chart>' +
    '<c:spPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:ln w="9525"><a:solidFill><a:srgbClr val="' + THEME.line + '"/></a:solidFill></a:ln></c:spPr>' +
    '<c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr><a:latin typeface="' + FONT + '"/></a:defRPr></a:pPr><a:endParaRPr lang="en-US"/></a:p></c:txPr></c:chartSpace>';
}

/** Browser download of a generated workbook. */
export function downloadWorkbook(buffer: Uint8Array, filename: string) {
  const blob = new Blob([buffer as BlobPart], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
