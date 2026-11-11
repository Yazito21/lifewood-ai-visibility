"use client";

import JSZip from "jszip";
import type { ReportSnapshot } from "@/lib/report-types";

export type MonthlyReportContent = {
  preparedBy: string;
  projectName: string;
  summaryDone: string;
  summaryFocus: string;
  knowledgeAssets: string;
  progress: Record<string, string[]>;
  initiatives: { area: string; title: string; description: string }[];
  actions: { week: string; website: string; knowledge: string; branding: string; community: string; monitoring: string }[];
  targets: Record<string, { score: string }>;
  competitorAssets: Record<string, string>;
  citationByCategory: Record<string, { citations: number; pages: { url: string; frequency: number }[] }>;
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

function updateChartCache(xml: string, seriesIndex: number, values: number[], labels?: string[]) {
  let numIndex = 0;
  let result = xml.replace(/<c:numCache>[\s\S]*?<\/c:numCache>/g, (cache) => {
    if (numIndex++ !== seriesIndex) return cache;
    const points = values.map((v, i) => '<c:pt idx="' + i + '"><c:v>' + String(Number.isFinite(v) ? v : 0) + '</c:v></c:pt>').join("");
    return cache.replace(/<c:ptCount val="\d+"\s*\/>/, '<c:ptCount val="' + values.length + '"/>')
      .replace(/<c:pt[\s\S]*?<\/c:pt>/g, "")
      .replace(/(<c:ptCount[^>]*\/>)/, "$1" + points);
  });
  if (labels?.length) {
    let strIndex = 0;
    result = result.replace(/<c:strCache>[\s\S]*?<\/c:strCache>/g, (cache) => {
      if (strIndex++ !== 1) return cache;
      const points = labels.map((v, i) => '<c:pt idx="' + i + '"><c:v>' + xmlEscape(v) + '</c:v></c:pt>').join("");
      return cache.replace(/<c:ptCount val="\d+"\s*\/>/, '<c:ptCount val="' + labels.length + '"/>')
        .replace(/<c:pt[\s\S]*?<\/c:pt>/g, "")
        .replace(/(<c:ptCount[^>]*\/>)/, "$1" + points);
    });
  }
  return result;
}

const dateLabel = (value: string) => new Date(value + "T00:00:00").toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
const pct = (value: number | null | undefined) => value == null ? "N/A" : value.toFixed(1) + "%";
const fmt = (value: number | null | undefined) => value == null ? "N/A" : value.toLocaleString("en-MY");

export async function generateMonthlyReportPptx(
  templateUrl: string,
  snapshot: ReportSnapshot,
  content: MonthlyReportContent,
) {
  const response = await fetch(templateUrl);
  if (!response.ok) throw new Error("The PowerPoint template could not be downloaded from platform storage.");
  const zip = await JSZip.loadAsync(await response.arrayBuffer());
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
    xml = setShapeText(xml, "Text 3", snapshot.period.label + " Report");
    return setShapeText(xml, "Text 4", "Prepared by " + (content.preparedBy || "Lifewood") + " on " + dateLabel(snapshot.period.end) + " as part of the " + (content.projectName || "AI Visibility") + " for " + snapshot.brand.name + ".");
  });

  await editSlide(2, (xml) => {
    xml = setShapeText(xml, "Text 6", pct(snapshot.overall.visibilityScore), 0);
    xml = setShapeText(xml, "Text 8", (content.summaryDone || "Progress summary to be completed").split("\n").slice(0, 2).join("\n"), 0);
    xml = setShapeText(xml, "Text 18", pct(snapshot.overall.shareOfVoice), 0);
    xml = setShapeText(xml, "Text 20", "Competitor comparison; " + snapshot.competitors.length + " brands tracked", 0);
    xml = setShapeText(xml, "Text 6", fmt(Object.values(content.citationByCategory).reduce((n, item) => n + item.citations, 0)), 1);
    xml = setShapeText(xml, "Text 8", "Brand website citations in the reporting period", 1);
    xml = setShapeText(xml, "Text 18", content.knowledgeAssets || "N/A", 1);
    xml = setShapeText(xml, "Text 20", "Audited knowledge assets; manually supplied", 1);
    xml = setShapeText(xml, "Text 23", "Improvements made in " + snapshot.period.label);
    xml = setShapeText(xml, "Text 24", content.summaryDone || "Progress summary to be completed");
    xml = setShapeText(xml, "Text 27", "Where to focus next");
    return setShapeText(xml, "Text 28", content.summaryFocus || "Priorities to be completed");
  });

  await editSlide(3, (xml) => {
    xml = setShapeText(xml, "Text 6", "Daily Visibility Score, " + dateLabel(snapshot.period.start) + " to " + dateLabel(snapshot.period.end));
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
    const metrics: [string, (c: typeof competitors[number] | null, i: number) => string][] = [
      ["Latest Visibility Score", (c) => pct(c?.visibilityScore)],
      ["Latest Share of Voice Score", (c) => pct(c?.shareOfVoice)],
      ["Latest Number of Citations", (c) => fmt(c?.citations)],
      ["Number of Knowledge Assets", (c) => c ? (c.isTracked ? (content.knowledgeAssets || "N/A") : (content.competitorAssets[c.name] || "N/A")) : "N/A"],
      ["Number of External Presence", (c) => c ? fmt(c.presence.websites + c.presence.directories + c.presence.social) + "\\n" + fmt(c.presence.websites) + " websites · " + fmt(c.presence.directories) + " directories · " + fmt(c.presence.social) + " social" : "N/A"],
    ];
    for (const [label, fn] of metrics) {
      const row = [label, fn(brandRow, -1), ...competitors.map((c, i) => fn(c, i))];
      while (row.length < 5) row.push("N/A");
      rows.push(row);
    }
    xml = setTable(xml, rows);
    return xml.replace(/\[AI platform\]/g, "AI platforms").replace(/\[region\]/g, snapshot.location).replace(/\[date\]/g, dateLabel(snapshot.period.end));
  });

  await editSlide(5, (xml) => {
    const citationEntries = Object.entries(content.citationByCategory);
    const total = citationEntries.reduce((sum, [, item]) => sum + item.citations, 0);
    const allPages = citationEntries.flatMap(([category, item]) => item.pages.map((page) => ({ ...page, category })))
      .sort((a, b) => b.frequency - a.frequency).slice(0, 7);
    xml = setShapeText(xml, "Text 6", fmt(total));
    xml = setShapeText(xml, "Text 7", "times AI platforms cited " + snapshot.brand.name + " website");
    xml = setShapeText(xml, "Text 8", dateLabel(snapshot.period.start) + " to " + dateLabel(snapshot.period.end));
    xml = setShapeText(xml, "Text 10", total ? "100%" : "0%");
    xml = setShapeText(xml, "Text 11", "of the brand website citations collected");
    xml = setShapeText(xml, "Text 12", "Citation totals by configured category");
    xml = setShapeText(xml, "Text 14", total ? "100%" : "0%");
    xml = setShapeText(xml, "Text 15", "of citations are attributed to tracked brand pages");
    xml = setShapeText(xml, "Text 16", String(new Set(allPages.map((p) => p.url)).size) + " of the listed brand pages were cited");
    xml = setShapeText(xml, "Text 18", "Share of citations pointing to " + snapshot.brand.name + " website");
    xml = setShapeText(xml, "Text 19", citationEntries.map(([name, item]) => name + " " + fmt(item.citations)).join(" · "));
    return setTable(xml, [["Page", "Category", "Citations"], ...Array.from({ length: 7 }, (_, i) => {
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
      xml = setShapeText(xml, bodyNames[i], (content.progress[area] || []).filter(Boolean).join("\n") || "No progress details entered");
    });
    return xml;
  });

  await editSlide(7, (xml) => {
    const titleNames = ["Text 8", "Text 13", "Text 18", "Text 23", "Text 28", "Text 33"];
    const descriptionNames = ["Text 9", "Text 14", "Text 19", "Text 24", "Text 29", "Text 34"];
    const areaNames = ["Text 7", "Text 12", "Text 17", "Text 22", "Text 32", "Text 32"];
    content.initiatives.slice(0, 6).forEach((item, i) => {
      xml = setShapeText(xml, titleNames[i], item.title || "Initiative " + (i + 1));
      xml = setShapeText(xml, descriptionNames[i], item.description || "Description to be completed");
      xml = setShapeText(xml, areaNames[i], item.area || "General", i === 5 ? 1 : 0);
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
    return setTable(xml, rows).replace(/\[next month\]/gi, "Next Month");
  });

  await editSlide(9, (xml) => {
    const slots = ["Overall", ...categories];
    const names = ["Overall", "Skin", "Mind", "Longevity"];
    for (let i = 0; i < 4; i++) {
      const category = slots[i] || "Not configured";
      const latest = i === 0 ? snapshot.overall.visibilityScore : categoryScores[i - 1];
      const target = Number(content.targets[category]?.score || 0);
      const gap = target && latest != null ? (target - latest).toFixed(1) : "N/A";
      xml = setShapeText(xml, "Card Title " + names[i], category);
      xml = setShapeText(xml, "Latest Value " + names[i], pct(latest));
      xml = setShapeText(xml, "Target Value " + names[i], target ? target.toFixed(1) + "%" : "Not set");
      xml = setShapeText(xml, "Gap " + names[i], gap === "N/A" ? "Target not set" : (Number(gap) >= 0 ? "+" : "") + gap + " pts to target");
    }
    return xml.replace(/\[next month\]/gi, "Next Month").replace(/\[AI platform\]/g, "AI platforms").replace(/\[region\]/g, snapshot.location).replace(/\[date\]/g, dateLabel(snapshot.period.end));
  });

  const chart2 = zip.file("ppt/charts/chart2.xml");
  if (chart2) {
    const xml = await chart2.async("string");
    const totalCitations = Object.values(content.citationByCategory).reduce((sum, item) => sum + item.citations, 0);
    const categoryShares = categories.map((category) => totalCitations ? (content.citationByCategory[category]?.citations ?? 0) / totalCitations * 100 : 0);
    const updated = updateChartCache(xml, 0, categoryShares);
    const labelsXml = updated.replace(/<c:strCache>[\\s\\S]*?<\\/c:strCache>/g, (cache, index) => cache);
    let strIndex = 0;
    const finalXml = labelsXml.replace(/<c:strCache>[\\s\\S]*?<\\/c:strCache>/g, (cache) => {
      if (strIndex++ !== 1) return cache;
      const points = categories.map((label, i) => '<c:pt idx="' + i + '"><c:v>' + xmlEscape(label) + '</c:v></c:pt>').join("");
      return cache.replace(/<c:ptCount val="\\d+"\\s*\\/>/, '<c:ptCount val="' + categories.length + '"/>')
        .replace(/<c:pt[\\s\\S]*?<\\/c:pt>/g, "")
        .replace(/(<c:ptCount[^>]*\\/>)/, "$1" + points);
    });
    zip.file("ppt/charts/chart2.xml", finalXml);
  }

  const chart1 = zip.file("ppt/charts/chart1.xml");
  if (chart1) {
    let xml = await chart1.async("string");
    xml = updateChartCache(xml, 0, values);
    xml = updateChartCache(xml, 1, values.map(() => targetValue));
    xml = updateChartCache(xml, 2, [], labels);
    zip.file("ppt/charts/chart1.xml", xml);
  }

  return zip.generateAsync({ type: "blob", mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation" });
}
