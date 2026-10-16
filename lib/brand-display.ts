export type CitedDomainCategory = "Direct competitor" | "Publisher / reference" | "Directory" | "Other cited domain";

const KNOWN_BRANDS: Record<string, string> = {
  "next-health.com": "Next Health",
  "nexthealth.com": "Next Health",
  "pmc.ncbi.nlm.nih.gov": "PubMed Central",
  "pubmed.ncbi.nlm.nih.gov": "PubMed",
  "ncbi.nlm.nih.gov": "NCBI",
  "healthline.com": "Healthline",
  "mayoclinic.org": "Mayo Clinic",
  "my.clevelandclinic.org": "Cleveland Clinic",
  "clevelandclinic.org": "Cleveland Clinic",
  "therapointusa.com": "Therapoint USA",
  "spahanahealth.com": "Spahana Health",
  "neuromaginstitute.com": "Neuromag Institute",
  "dynamicathlete.com": "Dynamic Athlete",
  "resurgencehealth.net": "Resurgence Health",
  "drdclinic.com": "Dr D Signature Clinic",
  "drkheng.com": "Dr K Heng",
  "cliqueclinic.com": "Clique Clinic",
  "myclinic.com.my": "MyClinic",
  "amclinic.com.my": "AM Clinic",
  "rjclinic.my": "RJ Clinic",
  "celln.co": "Celln",
  "healthgrades.com": "Healthgrades",
  "realself.com": "RealSelf",
  "webmd.com": "WebMD",
  "scienceinsights.org": "Science Insights",
  "springer.com": "Springer",
  "link.springer.com": "Springer",
  "sciencedirect.com": "ScienceDirect",
  "onlinelibrary.wiley.com": "Wiley Online Library",
  "wiley.com": "Wiley",
  "frontiersin.org": "Frontiers",
  "mdpi.com": "MDPI",
  "uclahealth.org": "UCLA Health",
  "latimes.com": "Los Angeles Times",
  "marieclaire.co.uk": "Marie Claire",
  "tuftsmedicarepreferred.org": "Tufts Health Plan",
  "health.harvard.edu": "Harvard Health",
  "pubmed.gov": "PubMed",
};

const PUBLISHER_DOMAINS = [
  "pubmed.ncbi.nlm.nih.gov", "pmc.ncbi.nlm.nih.gov", "ncbi.nlm.nih.gov", "nih.gov",
  "mayoclinic.org", "healthline.com", "webmd.com", "clevelandclinic.org", "health.harvard.edu",
  "springer.com", "sciencedirect.com", "wiley.com", "frontiersin.org", "mdpi.com",
  "nature.com", "nejm.org", "jamanetwork.com", "bmj.com", "thelancet.com", "academic.oup.com",
  "latimes.com", "marieclaire.co.uk", "uclahealth.org", "tuftsmedicarepreferred.org",
  "wikipedia.org", "britannica.com", "who.int", "cdc.gov", "nhs.uk", "medlineplus.gov",
  "health.clevelandclinic.org", "verywellhealth.com", "medicalnewstoday.com", "forbes.com",
  "businessinsider.com", "reuters.com", "apnews.com", "bbc.com", "nytimes.com",
];

const DIRECTORY_DOMAINS = [
  "goodfirms.co", "clutch.co", "yelp.com", "healthgrades.com", "realself.com",
  "zocdoc.com", "booksy.com", "fresha.com", "whatclinic.com", "topdoctors.com",
];

const DIRECT_COMPETITOR_TERMS = [
  "clinic", "clinics", "medical", "aesthetic", "aesthetics", "derma", "dermatology",
  "skin", "wellness", "medispa", "medspa", "antiaging", "anti-ageing", "cosmetic",
  "plasticsurgery", "plastic-surgery", "beauty", "healthcare", "health", "doctor",
  "doctors", "stemcell", "stem-cell", "longevity",
];

function cleanHost(value: string | null | undefined): string {
  if (!value) return "";
  const input = value.trim();
  try {
    const url = new URL(input.includes("://") ? input : "https://" + input);
    return url.hostname.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
  } catch {
    return input.toLowerCase().replace(/^www\./, "").split(/[/?#]/)[0].replace(/:\d+$/, "");
  }
}

function isHostOrSubdomain(host: string, domain: string) {
  return host === domain || host.endsWith("." + domain);
}

export function canonicalizeCitedUrl(input: string): string {
  try {
    const url = new URL(input);
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_.+|gclid|dclid|fbclid|msclkid|yclid|_ga|_gl|ref|source|campaign)$/i.test(key)) {
        url.searchParams.delete(key);
      }
    }
    url.protocol = "https:";
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    url.port = "";
    const query = [...url.searchParams.entries()].sort(([a], [b]) => a.localeCompare(b));
    url.search = "";
    for (const [key, value] of query) url.searchParams.append(key, value);
    if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, "");
    return url.toString().replace(/\/$/, url.pathname === "/" && !url.search ? "" : "/");
  } catch {
    return input;
  }
}

function titleCaseBrand(value: string): string {
  const acronyms: Record<string, string> = {
    ai: "AI", pmc: "PMC", ncbi: "NCBI", nih: "NIH", usa: "USA", uk: "UK",
    ucla: "UCLA", webmd: "WebMD", mdpi: "MDPI", am: "AM", dr: "Dr",
  };
  return value.split(/[\s-]+/).filter(Boolean).map((word) => {
    const lower = word.toLowerCase();
    return acronyms[lower] ?? (lower.charAt(0).toUpperCase() + lower.slice(1));
  }).join(" ");
}

export function brandDisplayName(rawBrand: string | null | undefined, urlOrWebsite?: string | null): string {
  const raw = (rawBrand ?? "").trim();
  const host = cleanHost(urlOrWebsite) || cleanHost(raw);
  if (host) {
    const known = Object.entries(KNOWN_BRANDS).find(([domain]) => isHostOrSubdomain(host, domain));
    if (known) return known[1];
  }
  if (raw && !/^https?:\/\//i.test(raw) && !/^[a-z0-9.-]+\.[a-z]{2,}(?:\/.*)?$/i.test(raw)) {
    return titleCaseBrand(raw.replace(/[_]+/g, " "));
  }
  const source = host || cleanHost(raw);
  if (!source) return raw || "Unknown";
  const labels = source.split(".");
  let brand = labels[0];
  if (labels.length >= 3 && ["gov", "edu", "ac", "org"].includes(labels.at(-1) ?? "")) {
    brand = labels[labels.length - 3] || labels[0];
  } else if (labels.length >= 2 && ["co.uk", "com.my", "com.sg", "co.nz", "com.au"].includes(labels.slice(-2).join("."))) {
    brand = labels[labels.length - 3] || labels[0];
  } else if (labels.length >= 2) {
    brand = labels[labels.length - 2];
  }
  brand = brand.replace(/\.(com|org|net|gov|edu|io|co|my|uk|au|sg|us)$/i, "");
  return titleCaseBrand(brand.replace(/[_.]+/g, " ").replace(/\.(com|org|net|gov|edu)$/i, ""));
}

export function classifyCitedDomain(urlOrWebsite: string | null | undefined, brandName?: string | null): CitedDomainCategory {
  const host = cleanHost(urlOrWebsite) || cleanHost(brandName);
  if (!host) return "Other cited domain";
  if (DIRECTORY_DOMAINS.some((domain) => isHostOrSubdomain(host, domain)) ||
      /(^|\.)(directory|directories|reviews|review|listings)\./i.test(host)) return "Directory";
  if (PUBLISHER_DOMAINS.some((domain) => isHostOrSubdomain(host, domain)) ||
      /(^|\.)(gov|edu|ac\.uk)$/.test(host) ||
      /(^|\.)(journal|news|magazine|research)\./i.test(host)) return "Publisher / reference";
  const haystack = (host + " " + (brandName ?? "")).toLowerCase().replace(/[^a-z0-9.-]/g, " ");
  if (DIRECT_COMPETITOR_TERMS.some((term) => haystack.includes(term))) return "Direct competitor";
  return "Other cited domain";
}
