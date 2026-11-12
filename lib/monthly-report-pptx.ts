"use client";

import JSZip from "jszip";
import ExcelJS from "exceljs";
import type { ReportSnapshot } from "@/lib/report-types";

export type MonthlyReportContent = {
  preparedBy: string;
  preparedOn: string;
  projectName: string;
  summaryDone: string;
  summaryFocus: string;
  knowledgeAssets: string;
  progress: Record<string, string[]>;
  initiatives: { area: string; title: string; description: string }[];
  actions: { week: string; website: string; knowledge: string; branding: string; community: string; monitoring: string }[];
  targets: Record<string, { score: string }>;
  competitorAssets: Record<string, string>;
  competitorDetails: Record<string, { knowledgeAssets: string; knowledgeDescription: string; externalTotal: string; news: string; directories: string; websites: string; social: string }>;
  citationByCategory: Record<string, { citations: number; totalCitations?: number; pages: { url: string; frequency: number }[] }>;
};

const xmlEscape = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function setTextInBlock(block: string, value: string) {
  let index = 0;
  const lines = value.split("\n");
  return block.replace(/(<a:t(?:\s+[^>]*)?>)([\s\S]*?)(<\/a:t>)/g, (_match, open, _old, close) => {
    const next = lines[index++] ?? "";
    return open + xmlEscape(next) + close;
  });
}

function setShapeText(xml: string, name: string, value: string, occurrence = 0) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const shapePattern = /<p:sp>[\s\S]*?<\/p:sp>/g;
  let seen = 0;
  return xml.replace(shapePattern, (block) => {
    if (!new RegExp('<p:cNvPr[^>]*name="' + escapedName + '"').test(block)) return block;
    if (seen++ !== occurrence) return block;
    return setTextInBlock(block, value);
  });
}


function setShapeBulletList(xml: string, name: string, items: string[]) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const shapePattern = /<p:sp>[\s\S]*?<\/p:sp>/g;
  return xml.replace(shapePattern, (block) => {
    if (!new RegExp('<p:cNvPr[^>]*name="' + escapedName + '"').test(block)) return block;
    const paragraphs = block.match(/<a:p>[\s\S]*?<\/a:p>/g) ?? [];
    const textParagraphs = paragraphs.filter((paragraph) => /<a:t(?:\s+[^>]*)?>/.test(paragraph));
    if (!textParagraphs.length) return block;
    const template = textParagraphs[0];
    const nextParagraphs = (items.length ? items : [""]).map((item, index) => setTextInBlock(textParagraphs[index] ?? template, item));
    const first = block.indexOf(textParagraphs[0]);
    const lastParagraph = textParagraphs[textParagraphs.length - 1];
    const last = block.lastIndexOf(lastParagraph) + lastParagraph.length;
    return block.slice(0, first) + nextParagraphs.join("") + block.slice(last);
  });
}
function setShapeTextAll(xml: string, name: string, value: string) {
  for (let occurrence = 0; occurrence < 12; occurrence++) {
    const next = setShapeText(xml, name, value, occurrence);
    if (next === xml) break;
    xml = next;
  }
  return xml;
}

function setTable(xml: string, rows: string[][]) {
  return xml.replace(/<p:graphicFrame>[\s\S]*?<\/p:graphicFrame>/g, (frame) => {
    if (!/<p:cNvPr[^>]*name="Table 0"/.test(frame)) return frame;
    let rowIndex = 0;
    return frame.replace(/<a:tr[\s\S]*?<\/a:tr>/g, (row) => {
      const values = rows[rowIndex++] ?? [];
      let colIndex = 0;
      return row.replace(/<a:tc>[\s\S]*?<\/a:tc>/g, (cell) => {
        const value = values[colIndex++];
        return value === undefined ? cell : setTextInBlock(cell, value);
      });
    });
  });
}

function replaceCachePoints(cache: string, values: (string | number)[]) {
  const tag = cache.match(/^<c:(numCache|strCache)>/)?.[1];
  if (!tag) return cache;
  const formatCode = cache.match(/<c:formatCode>[\s\S]*?<\/c:formatCode>/)?.[0] ?? "";
  const points = values.map((value, index) =>
    '<c:pt idx="' + index + '"><c:v>' + (typeof value === "number" ? String(Number.isFinite(value) ? value : 0) : xmlEscape(value)) + '</c:v></c:pt>',
  ).join("");
  return '<c:' + tag + '>' + formatCode + '<c:ptCount val="' + values.length + '"/>' + points + '</c:' + tag + '>';
}

function updateSeriesChartCache(xml: string, seriesIndex: number, values: number[], labels: string[]) {
  let currentSeries = 0;
  return xml.replace(/<c:ser>[\s\S]*?<\/c:ser>/g, (series) => {
    if (currentSeries++ !== seriesIndex) return series;
    let stringCacheIndex = 0;
    series = series.replace(/<c:strCache>[\s\S]*?<\/c:strCache>/g, (cache) => {
      const index = stringCacheIndex++;
      return index === 1 ? replaceCachePoints(cache, labels) : cache;
    });
    let numericCacheUpdated = false;
    series = series.replace(/<c:numCache>[\s\S]*?<\/c:numCache>/g, (cache) => {
      if (numericCacheUpdated) return cache;
      numericCacheUpdated = true;
      return replaceCachePoints(cache, values);
    });
    return series;
  });
}

const dateLabel = (value: string) => new Date(value + "T00:00:00").toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
const pct = (value: number | null | undefined) => value == null ? "N/A" : value.toFixed(1) + "%";
const fmt = (value: number | null | undefined) => value == null ? "N/A" : value.toLocaleString("en-MY");
const periodLabel = (snapshot: ReportSnapshot) => {
  const startMonth = snapshot.period.start.slice(0, 7);
  const endMonth = snapshot.period.end.slice(0, 7);
  if (startMonth === endMonth) return new Date(snapshot.period.start + "T00:00:00").toLocaleDateString("en-GB", { month: "long" });
  return dateLabel(snapshot.period.start) + " to " + dateLabel(snapshot.period.end);
};
const nextMonthLabel = (snapshot: ReportSnapshot) => {
  const [year, month] = snapshot.period.end.slice(0, 7).split("-").map(Number);
  return new Date(Date.UTC(year, month, 1)).toLocaleDateString("en-GB", { month: "long" });
};
const compactNumber = (value: number) => value.toLocaleString("en-MY");
const formatSignedPercent = (value: number) => {
  const rounded = Number(value.toFixed(1));
  return (rounded > 0 ? "+" : "") + String(rounded) + "%";
};
const changeAndPeak = (series: { date: string; score: number | null }[]) => {
  const valid = series.filter((point): point is { date: string; score: number } => point.score !== null).sort((a, b) => a.date.localeCompare(b.date));
  if (!valid.length) return "Change vs start of month: N/A; Peak Score: N/A";
  const first = valid[0];
  const last = valid[valid.length - 1];
  const peak = valid.reduce((best, point) => point.score > best.score ? point : best, first);
  const change = last.score - first.score;
  return "Change vs start of month: " + formatSignedPercent(change) + "; Peak Score: " + pct(peak.score) + " on " + dateLabel(peak.date);
};
const numericCount = (value: string | undefined) => {
  if (!value?.trim()) return null;
  const parsed = Number(value.replace(/,/g, "").trim());
  return Number.isFinite(parsed) ? parsed : null;
};
const compareToCompetitor = (brandValue: number | null, competitorValue: number | null, competitorName: string) => {
  if (brandValue === null || competitorValue === null) return "Comparison unavailable";
  const delta = brandValue - competitorValue;
  return (delta > 0 ? "+" : "") + compactNumber(delta) + " compared to the highest performing competitor (" + competitorName + ")";
};

export async function generateMonthlyReportPptx(
  templateUrl: string,
  snapshot: ReportSnapshot,
  content: MonthlyReportContent,
  brandLogoUrl?: string,
) {
  const response = await fetch(templateUrl);
  if (!response.ok) throw new Error("The PowerPoint template could not be downloaded from platform storage.");
  const zip = await JSZip.loadAsync(await response.arrayBuffer());
  if (brandLogoUrl) {
    try {
      const logoResponse = await fetch(brandLogoUrl, { cache: "no-store" });
      if (logoResponse.ok) {
        const source = await logoResponse.blob();
        const bitmap = await createImageBitmap(source);
        const canvas = document.createElement("canvas");
        canvas.width = 2104; canvas.height = 285;
        const context = canvas.getContext("2d");
        if (context) {
          const scale = Math.min((canvas.width - 40) / bitmap.width, (canvas.height - 20) / bitmap.height);
          const width = bitmap.width * scale;
          const height = bitmap.height * scale;
          context.drawImage(bitmap, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
          const png = await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("Logo conversion failed")), "image/png"));
          zip.file("ppt/media/image3.png", await png.arrayBuffer());
        }
        bitmap.close();
      }
    } catch (error) { console.warn("Brand logo could not be embedded in the report:", error); }
  }
  const categories = snapshot.brand.categories.slice(0, 3);
  const categoryScores = categories.map((name) => snapshot.byCategory.find((row) => row.category === name)?.visibilityScore ?? null);
  const trend = snapshot.trend;
  const labels = trend.map((row) => dateLabel(row.date));
  const values = trend.map((row) => Number(row.score ?? 0));
  const targetValue = Number(content.targets.Overall?.score || 0);

  const editSlide = async (number: number, edit: (xml: string) => string) => {
    const file = zip.file("ppt/slides/slide" + number + ".xml");
    if (!file) return;
    zip.file("ppt/slides/slide" + number + ".xml", edit(await file.async("string")));
  };

  await editSlide(1, (xml) => {
    xml = setShapeText(xml, "Text 1", snapshot.brand.name);
    xml = setShapeText(xml, "Text 3", periodLabel(snapshot) + " Report");
    return setShapeText(xml, "Text 4", "Prepared by " + (content.preparedBy || "Platform User") + " on " + dateLabel(content.preparedOn || snapshot.period.end) + " as part of the SEO/GEO project operations for " + snapshot.brand.name + ".");
  });

  const visibilityCompetitor = snapshot.competitors
    .filter((row) => !row.isTracked && row.visibilityScore !== null)
    .sort((a, b) => (b.visibilityScore ?? -Infinity) - (a.visibilityScore ?? -Infinity))[0] ?? null;
  const trackedCitationCount = Object.values(content.citationByCategory ?? {}).reduce((sum, item) => sum + Number(item.citations || 0), 0);
  const competitorCitationCount = visibilityCompetitor?.citations ?? null;
  const citationComparison = compareToCompetitor(trackedCitationCount, competitorCitationCount, visibilityCompetitor?.name ?? "N/A");
  const trackedKnowledgeCount = numericCount(content.knowledgeAssets);
  const competitorKnowledgeCount = visibilityCompetitor ? numericCount(content.competitorDetails?.[visibilityCompetitor.name]?.knowledgeAssets) : null;
  const knowledgeComparison = compareToCompetitor(trackedKnowledgeCount, competitorKnowledgeCount, visibilityCompetitor?.name ?? "N/A");
  const visibilityChangeAndPeak = changeAndPeak(snapshot.trend ?? []);
  const shareOfVoiceChangeAndPeak = changeAndPeak(snapshot.shareOfVoiceTrend ?? []);

  await editSlide(2, (xml) => {
    xml = setShapeText(xml, "Text 6", pct(snapshot.overall.visibilityScore), 0);
    xml = setShapeText(xml, "Text 8", visibilityChangeAndPeak, 0);
    xml = setShapeText(xml, "Text 18", pct(snapshot.overall.shareOfVoice), 0);
    xml = setShapeText(xml, "Text 20", shareOfVoiceChangeAndPeak, 0);
    xml = setShapeText(xml, "Text 6", fmt(trackedCitationCount), 1);
    xml = setShapeText(xml, "Text 8", citationComparison, 1);
    xml = setShapeText(xml, "Text 18", content.knowledgeAssets || "N/A", 1);
    xml = setShapeText(xml, "Text 20", knowledgeComparison, 1);
    xml = setShapeText(xml, "Text 23", "Improvements made in " + periodLabel(snapshot));
    xml = setShapeText(xml, "Text 24", content.summaryDone || "Progress summary to be completed");
    xml = setShapeText(xml, "Text 27", "Where to focus in " + nextMonthLabel(snapshot));
    return setShapeText(xml, "Text 28", content.summaryFocus || "Priorities to be completed");
  });

  await editSlide(3, (xml) => {
    xml = setShapeText(xml, "Text 6", "Daily Visibility Score, " + dateLabel(snapshot.period.start) + " to " + dateLabel(snapshot.period.end));
    xml = setShapeText(xml, "Chart Caption", "Visibility Score: the percentage of benchmark questions that mentions " + snapshot.brand.name + " in its answer. A higher score means AI recommends the brand more often.");
    xml = setShapeText(xml, "Text 10", pct(snapshot.overall.visibilityScore));
    for (let i = 0; i < 3; i++) {
      xml = setShapeText(xml, "Text " + [13, 17, 21][i], "Latest Score for " + (categories[i] || "Category " + (i + 1)));
      xml = setShapeText(xml, "Text " + [14, 18, 22][i], pct(categoryScores[i]));
    }
    xml = xml.replace(/\[AI platform\]/g, "AI platforms").replace(/\[region\]/g, snapshot.location);
    return xml;
  });

  await editSlide(4, (xml) => {
    const brandRow = snapshot.competitors.find((c) => c.isTracked) ?? null;
    const competitors = snapshot.competitors.filter((c) => !c.isTracked).slice(0, 3);
    const headers = ["Category", snapshot.brand.name, ...competitors.map((c) => c.name)];
    while (headers.length < 5) headers.push("Not tracked");
    const rows = [headers];
    const manual = (c: typeof competitors[number] | null) => c ? (content.competitorDetails?.[c.name] ?? { knowledgeAssets: "", knowledgeDescription: "", externalTotal: "", news: "", directories: "", websites: "", social: "" }) : null;
    const metrics: [string, (c: typeof competitors[number] | null, i: number) => string][] = [
      ["Latest Visibility Score", (c) => pct(c?.visibilityScore)],
      ["Latest Share of Voice Score", (c) => pct(c?.shareOfVoice)],
      ["Latest Number of Citations", (c) => fmt(c?.citations)],
      ["Number of Knowledge Assets", (c) => { const d = manual(c); return d ? (d.knowledgeAssets || "—") + (d.knowledgeDescription ? "\\n" + d.knowledgeDescription : "") : "—"; }],
      ["Number of External Presence", (c) => {
        const d = manual(c);
        return d ? (d.externalTotal || "—") + "\n" + (d.news || "—") + " news · " + (d.directories || "—") + " directories / websites · " + (d.websites || "—") + " websites · " + (d.social || "—") + " social media" : "—";
      }],
    ];
    for (const [label, fn] of metrics) {
      const row = [label, fn(brandRow, -1), ...competitors.map((c, i) => fn(c, i))];
      while (row.length < 5) row.push("N/A");
      rows.push(row);
    }
    xml = setTable(xml, rows);
    const auditDate = dateLabel(snapshot.period.end);
    const caption = "Visibility, share of voice and citations: latest run on " + auditDate + ". Knowledge assets and external presence checked on each website and the open web on " + auditDate + "; external presence is a best-effort count.";
    xml = setShapeText(xml, "Text 5", caption);
    return xml.replace(/\[AI platform\]/g, "AI platforms").replace(/\[region\]/g, snapshot.location).replace(/\[date\]/g, auditDate);
  });

  await editSlide(5, (xml) => {
    const citationEntries = categories.map(category => [category, content.citationByCategory?.[category] ?? { citations: 0, totalCitations: 0, pages: [] }] as const);
    const totalBrandCitations = citationEntries.reduce((sum, [, item]) => sum + Number(item.citations || 0), 0);
    const totalAllCitations = citationEntries.reduce((sum, [, item]) => sum + Number(item.totalCitations || 0), 0);
    const everyPage = citationEntries.flatMap(([category, item]) => item.pages.map((page) => ({ ...page, category })));
    const allPages = [...everyPage].sort((a, b) => b.frequency - a.frequency).slice(0, 5);
    const distinctPages = new Set(everyPage.map(page => page.url)).size;
    const brandWebsite = (() => { try { const website = snapshot.brand.website || ""; return new URL(website.includes("://") ? website : "https://" + website).hostname.toLowerCase().replace(/^www\./, "") || snapshot.brand.name; } catch { return snapshot.brand.name; } })();
    xml = setShapeText(xml, "Text 6", fmt(totalBrandCitations));
    xml = setShapeText(xml, "Text 7", "times AI platforms cited " + brandWebsite);
    xml = setShapeText(xml, "Text 8", dateLabel(snapshot.period.start) + " to " + dateLabel(snapshot.period.end));
    const brandShareOfAllCitations = totalAllCitations > 0 ? totalBrandCitations / totalAllCitations * 100 : null;
    xml = setShapeText(xml, "Text 10", pct(brandShareOfAllCitations));
    xml = setShapeText(xml, "Text 11", "of all " + fmt(totalAllCitations) + " citations");
    xml = setShapeText(xml, "Text 12", citationComparison);
    const topCategory = [...citationEntries].sort((a,b)=>b[1].citations-a[1].citations)[0] ?? null;
    const topCategoryShare = totalBrandCitations > 0 && topCategory ? topCategory[1].citations / totalBrandCitations * 100 : null;
    xml = setShapeText(xml, "Text 14", pct(topCategoryShare));
    xml = setShapeText(xml, "Text 15", "of brand citations come from " + (topCategory?.[0] ?? "N/A") + " pages");
    xml = setShapeText(xml, "Text 16", fmt(distinctPages) + " of the brand’s pages were cited at least once");
    xml = setShapeText(xml, "Text 18", "Share of citations pointing to " + brandWebsite);
    xml = setShapeText(xml, "Text 19", citationEntries.map(([name, item]) => name + " " + fmt(item.citations) + "/" + fmt(item.totalCitations || 0)).join(" · "));
    return setTable(xml, [["Page", "Category", "Citations"], ...Array.from({ length: 5 }, (_, i) => {
      const page = allPages[i];
      return page ? [page.url, page.category, fmt(page.frequency)] : ["—", "—", "—"];
    })]);
  });

  await editSlide(6, (xml) => {
    const areaNames = ["Website Content and Structure", "Knowledge Assets and Resources", "Branding and Authority", "Community Engagement", "Monitoring and Research"];
    const headerNames = ["Text 7", "Text 11", "Text 15", "Text 19", "Text 23"];
    const bodyNames = ["Text 8", "Text 12", "Text 16", "Text 20", "Text 24"];
    areaNames.forEach((area, i) => {
      xml = setShapeText(xml, headerNames[i], area);
      xml = setShapeText(xml, bodyNames[i], (content.progress[area] || []).filter(Boolean).join("\n"));
    });
    return xml;
  });

  await editSlide(7, (xml) => {
    const titleNames = ["Text 8", "Text 13", "Text 18", "Text 23", "Text 28", "Text 33"];
    const descriptionNames = ["Text 9", "Text 14", "Text 19", "Text 24", "Text 29", "Text 34"];
    const areaNames = ["Text 7", "Text 12", "Text 17", "Text 22", "Text 32", "Text 32"];
    content.initiatives.slice(0, 6).forEach((item, i) => {
      xml = setShapeText(xml, titleNames[i], item.title || "");
      xml = setShapeText(xml, descriptionNames[i], item.description || "");
      xml = setShapeText(xml, areaNames[i], item.area || ["Website","Website","Knowledge","Branding","Community","Monitoring"][i], i === 5 ? 1 : 0);
    });
    return xml;
  });

  await editSlide(8, (xml) => {
    const rows = [["Timing", "Focus"], ...Array.from({ length: 5 }, (_, i) => {
      const action = content.actions[i];
      if (!action) return ["—", "No action plan entered"];
      const lines = [
        action.website && "Website: " + action.website,
        action.knowledge && "Knowledge: " + action.knowledge,
        action.branding && "Branding: " + action.branding,
        action.community && "Community: " + action.community,
        action.monitoring && "Monitoring: " + action.monitoring,
      ].filter(Boolean);
      return [action.week, lines.join("\n") || "Action plan to be completed"];
    })];
    return setTable(xml, rows).replace(/\[next month\]/gi, nextMonthLabel(snapshot));
  });

  await editSlide(9, (xml) => {
    const slots = ["Overall", ...categories];
    const names = ["Overall", "Skin", "Mind", "Longevity"];
    for (let i = 0; i < 4; i++) {
      const category = slots[i] || "Not configured";
      const latest = i === 0 ? snapshot.overall.visibilityScore : categoryScores[i - 1];
      const target = Number(content.targets[category]?.score || 0);
      const gap = target && latest != null ? (target - latest).toFixed(1) : "N/A";
      xml = setShapeTextAll(xml, "Card Title " + names[i], category);
      xml = setShapeTextAll(xml, "Latest Value " + names[i], pct(latest));
      xml = setShapeTextAll(xml, "Target Value " + names[i], target ? target.toFixed(1) + "%" : "Not set");
      xml = setShapeTextAll(xml, "Gap " + names[i], gap === "N/A" ? "Target not set" : (Number(gap) >= 0 ? "+" : "") + gap + " pts to target");
    }
    return xml.replace(/\[next month\]/gi, nextMonthLabel(snapshot)).replace(/\[AI platform\]/g, "AI platforms").replace(/\[region\]/g, snapshot.location).replace(/\[date\]/g, dateLabel(snapshot.period.end)).replace(/\[benchmark description\]/g, "configured benchmark prompts and tracked competitors");
  });

  // Update the embedded Excel workbooks as well as the chart caches. PowerPoint
  // uses both sources; changing only cached XML values can leave charts blank.
  const chart1WorkbookFile = zip.file("ppt/embeddings/Microsoft_Excel_Worksheet.xlsx");
  if (chart1WorkbookFile) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await chart1WorkbookFile.async("arraybuffer"));
    const sheet = workbook.getWorksheet("Sheet1");
    if (sheet) {
      sheet.getCell("B1").value = "Visibility score (%)";
      sheet.getCell("C1").value = "Next Target (" + targetValue + "%)";
      for (let i = 0; i < 59; i++) {
        const row = i + 2;
        const point = trend[i];
        sheet.getCell("A" + row).value = point ? dateLabel(point.date) : null;
        sheet.getCell("B" + row).value = point?.score ?? null;
        sheet.getCell("C" + row).value = point ? targetValue : null;
      }
    }
    zip.file("ppt/embeddings/Microsoft_Excel_Worksheet.xlsx", await workbook.xlsx.writeBuffer());
  }

  const chart1 = zip.file("ppt/charts/chart1.xml");
  if (chart1) {
    let xml = await chart1.async("string");
    const chartLabels = labels.slice(0, 59);
    xml = updateSeriesChartCache(xml, 0, values.slice(0, 59), chartLabels);
    xml = updateSeriesChartCache(xml, 1, values.slice(0, 59).map(() => targetValue), chartLabels);
    const highestChartValue = Math.max(targetValue, ...values, 0);
    const axisMax = highestChartValue <= 30 ? 30 : Math.ceil((highestChartValue + 1) / 10) * 10;
    xml = xml
      .replace(/<c:max val="[^"]*"\/>/, '<c:max val="' + axisMax + '" />')
      .replace(/<c:majorUnit val="[^"]*"\/>/, '<c:majorUnit val="' + (axisMax > 40 ? 10 : 5) + '" />')
      .replace(/Sheet1!\$A\$2:\$A\$60/g, "Sheet1!$A$2:$A$" + Math.max(2, chartLabels.length + 1))
      .replace(/Sheet1!\$B\$2:\$B\$60/g, "Sheet1!$B$2:$B$" + Math.max(2, chartLabels.length + 1))
      .replace(/Sheet1!\$C\$2:\$C\$60/g, "Sheet1!$C$2:$C$" + Math.max(2, chartLabels.length + 1))
      .replace(/\[XX\]/g, String(targetValue));
    zip.file("ppt/charts/chart1.xml", xml);
  }

  const chart2WorkbookFile = zip.file("ppt/embeddings/Microsoft_Excel_Worksheet1.xlsx");
  const citationEntries = Object.entries(content.citationByCategory).slice(0, 3);
  const citationTotal = citationEntries.reduce((sum, [, item]) => sum + item.citations, 0);
  const categoryShares = citationEntries.map(([, item]) => citationTotal ? item.citations / citationTotal * 100 : 0);
  const citationLabels = citationEntries.map(([category]) => category);
  if (chart2WorkbookFile) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await chart2WorkbookFile.async("arraybuffer"));
    const sheet = workbook.getWorksheet("Sheet1");
    if (sheet) {
      sheet.getCell("B1").value = "Brand share";
      for (let i = 0; i < 3; i++) {
        const row = i + 2;
        sheet.getCell("A" + row).value = citationLabels[i] ?? null;
        sheet.getCell("B" + row).value = categoryShares[i] ?? null;
      }
    }
    zip.file("ppt/embeddings/Microsoft_Excel_Worksheet1.xlsx", await workbook.xlsx.writeBuffer());
  }

  const chart2 = zip.file("ppt/charts/chart2.xml");
  if (chart2) {
    let xml = await chart2.async("string");
    xml = updateSeriesChartCache(xml, 0, categoryShares, citationLabels)
      .replace(/Sheet1!\$A\$2:\$A\$4/g, "Sheet1!$A$2:$A$" + Math.max(2, citationLabels.length + 1))
      .replace(/Sheet1!\$B\$2:\$B\$4/g, "Sheet1!$B$2:$B$" + Math.max(2, citationLabels.length + 1));
    zip.file("ppt/charts/chart2.xml", xml);
  }

  return zip.generateAsync({ type: "blob", mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation" });
}
