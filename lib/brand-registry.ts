import * as XLSX from "xlsx";

export type BrandImportRow = {
  category: string;
  brand: string;
  aliases: string[];
  website: string;
  otherWebsites: string[];
  role: "tracked_brand" | "competitor";
  notes?: string;
};

export function normaliseBrandKey(value: string) {
  return value.trim().toLocaleLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "");
}

export function normaliseWebsite(value: string) {
  const raw = value.trim();
  if (!raw) return "";
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : "https://" + raw);
    return url.hostname.toLocaleLowerCase().replace(/^www\./, "");
  } catch {
    return raw.toLocaleLowerCase().replace(/^https?:\/\//i, "").replace(/^www\./, "").split(/[/?#]/)[0];
  }
}

function splitList(value: unknown): string[] {
  return String(value ?? "").split(/[;|\n]/).map((part) => part.trim()).filter(Boolean);
}

export function parseBrandWorkbook(buffer: ArrayBuffer): { categories: string[]; rows: BrandImportRow[] } {
  const workbook = XLSX.read(buffer, { type: "array" });
  // Workbooks downloaded before the topic -> category rename still use "Topics" / "Topic"; accept both.
  const categorySheet = workbook.Sheets.Categories ?? workbook.Sheets.Topics;
  const brandSheet = workbook.Sheets.Brands;
  if (!brandSheet) throw new Error('The workbook must contain a "Brands" sheet.');
  const categoryRows = categorySheet ? XLSX.utils.sheet_to_json<Record<string, unknown>>(categorySheet, { defval: "" }) : [];
  const categoriesFromSheet = categoryRows.map((row) => String(row.Category ?? row.category ?? row.Topic ?? row.topic ?? "").trim()).filter(Boolean);
  const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(brandSheet, { defval: "" });
  const rows = rawRows.map((row) => {
    const category = String(row.Category ?? row.category ?? row.Topic ?? row.topic ?? "").trim();
    const brand = String(row.Brand ?? row["Brand Name"] ?? row.brand ?? "").trim();
    const aliases = splitList(row.Aliases ?? row.Alias);
    const website = String(row.Website ?? row["Primary Website"] ?? "").trim();
    const otherWebsites = splitList(row["Other Websites"] ?? row.OtherWebsites ?? row["Additional Websites"]);
    const roleText = String(row.Role ?? "").trim().toLocaleLowerCase().replace(/[ -]/g, "_");
    const role = roleText === "tracked_brand" || roleText === "tracked" ? "tracked_brand" : "competitor";
    const notes = String(row.Notes ?? "").trim();
    return { category, brand, aliases, website, otherWebsites, role: role as BrandImportRow["role"], notes };
  }).filter((row) => row.category && row.brand);
  return { categories: [...new Set([...categoriesFromSheet, ...rows.map((row) => row.category)])], rows };
}

export function validateBrandRows(rows: BrandImportRow[], categories: string[], trackedBrand: string, enforceHundred = true): string[] {
  const errors: string[] = [];
  if (!categories.length) return ["Add at least one tracking category."];
  for (const category of categories) {
    const categoryRows = rows.filter((row) => row.category === category);
    const tracked = categoryRows.filter((row) => row.role === "tracked_brand" || normaliseBrandKey(row.brand) === normaliseBrandKey(trackedBrand));
    const distinct = new Set(categoryRows.map((row) => normaliseBrandKey(row.brand)));
    if (tracked.length !== 1) errors.push(`${category}: expected exactly one tracked brand (${trackedBrand}); found ${tracked.length}.`);
    if (distinct.size !== categoryRows.length) errors.push(`${category}: duplicate brand names found. Each brand should appear once per category.`);
    if (enforceHundred && categoryRows.length !== 100) errors.push(`${category}: expected 100 brands (1 tracked brand + 99 competitors); found ${categoryRows.length}.`);
    const competitorCount = categoryRows.filter((row) => row.role !== "tracked_brand" && normaliseBrandKey(row.brand) !== normaliseBrandKey(trackedBrand)).length;
    if (enforceHundred && competitorCount !== 99) errors.push(`${category}: expected 99 competitors; found ${competitorCount}.`);
    for (const row of categoryRows) if (!row.website.trim()) errors.push(`${category}: "${row.brand}" is missing its primary website.`);
  }
  for (const row of rows) if (!categories.includes(row.category)) errors.push(`"${row.category}" is not present in the Categories sheet.`);
  return errors;
}

export function downloadBrandTemplate(categories: string[], trackedBrand: string, trackedWebsite = "") {
  const workbook = XLSX.utils.book_new();
  const instructions = [
    ["AI Visibility Brand Registry Template"],
    ["Use one row per brand per category. Each category must contain exactly 100 brands: 1 tracked brand and 99 competitors."],
    ["Required columns on Brands: Category, Brand, Aliases, Website, Other Websites, Role, Notes."],
    ["Separate multiple aliases and additional websites with semicolons. Use verified official domains only."],
    ["The tracked brand must appear exactly once in each category. Leave the blank competitor rows blank until filled."],
    ["Do not rename the Categories or Brands sheets."],
  ];
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(instructions), "Instructions");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["Category"], ...categories.map((category) => [category])]), "Categories");
  const brandRows: Array<Array<string>> = [["Category", "Brand", "Aliases", "Website", "Other Websites", "Role", "Notes"]];
  for (const category of categories) {
    brandRows.push([category, trackedBrand, "", trackedWebsite, "", "tracked_brand", "Tracked brand"]);
    for (let i = 1; i <= 99; i++) brandRows.push([category, "", "", "", "", "competitor", `Competitor slot ${i}`]);
  }
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(brandRows), "Brands");
  XLSX.writeFile(workbook, "ai-visibility-brand-registry-template.xlsx");
}

export async function saveProjectBrandRegistry(
  client: any,
  projectId: string,
  trackedBrand: string,
  categories: string[],
  rows: BrandImportRow[],
  trackedWebsite = "",
) {
  const merged = new Map<string, { canonical_name: string; normalized_key: string; aliases: Set<string>; websites: Set<string>; tracked: boolean }>();
  for (const row of rows) {
    const key = normaliseBrandKey(row.brand);
    if (!key) continue;
    const existing = merged.get(key) ?? { canonical_name: row.brand.trim(), normalized_key: key, aliases: new Set<string>(), websites: new Set<string>(), tracked: false };
    row.aliases.forEach((alias) => existing.aliases.add(alias));
    [row.website, ...row.otherWebsites].filter(Boolean).forEach((website) => existing.websites.add(normaliseWebsite(website)));
    existing.tracked ||= row.role === "tracked_brand" || key === normaliseBrandKey(trackedBrand);
    merged.set(key, existing);
  }
  const trackedKey = normaliseBrandKey(trackedBrand);
  if (!merged.has(trackedKey)) merged.set(trackedKey, { canonical_name: trackedBrand, normalized_key: trackedKey, aliases: new Set(), websites: new Set(trackedWebsite ? [normaliseWebsite(trackedWebsite)] : []), tracked: true });
  const directoryRows = [...merged.values()].map((item) => {
    const websites = [...item.websites].filter(Boolean);
    return {
      project_id: projectId, canonical_name: item.canonical_name, normalized_key: item.normalized_key,
      aliases: [...item.aliases], primary_website: websites[0] ?? null,
      additional_websites: websites.slice(1), is_tracked_brand: item.tracked, is_active: true,
      updated_at: new Date().toISOString(),
    };
  });
  const savedBrandRows: Array<{id:string;normalized_key:string}> = [];
  for(let offset=0;offset<directoryRows.length;offset+=100){
    const batch=directoryRows.slice(offset,offset+100);
    const {data,error:registryError}=await client.from("brand_registry").upsert(batch,{onConflict:"project_id,normalized_key"}).select("id,normalized_key");
    if(registryError)throw registryError;
    savedBrandRows.push(...((data??[]) as Array<{id:string;normalized_key:string}>));
  }
  const savedBrands=savedBrandRows;
  const brandIdByKey = new Map<string, string>(savedBrands.map((item) => [item.normalized_key, item.id]));
  const { error: deleteError } = await client.from("category_brand_assignments").delete().eq("project_id", projectId);
  if (deleteError) throw deleteError;
  const assignments = rows.filter((row) => categories.includes(row.category)).map((row) => {
    const key = normaliseBrandKey(row.brand);
    const brand_id = brandIdByKey.get(key);
    if (!brand_id) throw new Error(`Unable to resolve brand ID for ${row.brand}.`);
    return {
      project_id: projectId, category: row.category, brand_id,
      role: (row.role === "tracked_brand" || key === trackedKey ? "tracked_brand" : "competitor") as BrandImportRow["role"],
      aliases: row.aliases,
      websites: [...new Set([row.website, ...row.otherWebsites].filter(Boolean).map(normaliseWebsite))],
      include_in_metrics: true, notes: row.notes || null, updated_at: new Date().toISOString(),
    };
  });
  if (assignments.length) {
    const { error: assignmentError } = await client.from("category_brand_assignments").insert(assignments);
    if (assignmentError) throw assignmentError;
  }
  // A brand can remain in the central directory after being removed from every
  // category. Mark it inactive so its domains no longer suppress third-party records.
  const { data: existingDirectory, error: existingDirectoryError } = await client.from("brand_registry")
    .select("id").eq("project_id", projectId).eq("is_active", true);
  if (existingDirectoryError) throw existingDirectoryError;
  const activeIds = new Set<string>((savedBrands ?? []).map((item: any) => String(item.id)));
  const staleIds = (existingDirectory ?? []).map((item: any) => String(item.id)).filter((id: string) => !activeIds.has(id));
  for (let offset = 0; offset < staleIds.length; offset += 80) {
    const { error: deactivateError } = await client.from("brand_registry").update({ is_active: false, updated_at: new Date().toISOString() })
      .eq("project_id", projectId).in("id", staleIds.slice(offset, offset + 80));
    if (deactivateError) throw deactivateError;
  }
  const tracked = merged.get(trackedKey);
  const trackedWebsites = [...(tracked?.websites ?? new Set<string>())].filter(Boolean);
  const trackedAliases = [...(tracked?.aliases ?? new Set<string>())].filter((alias) => normaliseBrandKey(alias) !== trackedKey);
  // Merge rather than replace: an import file that lists fewer tracked-brand aliases or domains must not
  // silently narrow how the tracked brand is matched (that would change its historical visibility).
  const { data: existingProject, error: existingProjectError } = await client.from("projects")
    .select("brand_terms,brand_domains").eq("id", projectId).single();
  if (existingProjectError) throw existingProjectError;
  const mergedTerms = [...new Set<string>([...((existingProject?.brand_terms ?? []) as string[]), ...trackedAliases])];
  const mergedDomains = [...new Set<string>([...((existingProject?.brand_domains ?? []) as string[]).map(normaliseWebsite), ...trackedWebsites])].filter(Boolean);
  const { error: projectError } = await client.from("projects").update({
    categories,
    brand_domains: mergedDomains,
    brand_terms: mergedTerms,
  }).eq("id", projectId);
  if (projectError) throw projectError;
}

export function downloadBrandRegistryWorkbook(categories: string[], rows: BrandImportRow[]) {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ["AI Visibility Brand Registry"],
    ["Edit the Brands sheet and upload it in Settings. Each category should contain one tracked brand and 99 competitors."],
  ]), "Instructions");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["Category"], ...categories.map((category) => [category])]), "Categories");
  const data: Array<Array<string>> = [["Category", "Brand", "Aliases", "Website", "Other Websites", "Role", "Notes"]];
  for (const row of rows) data.push([row.category,row.brand,row.aliases.join("; "),row.website,row.otherWebsites.join("; "),row.role,row.notes ?? ""]);
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(data), "Brands");
  XLSX.writeFile(workbook, "ai-visibility-brand-registry.xlsx");
}
