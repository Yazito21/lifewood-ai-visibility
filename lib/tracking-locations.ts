export type TrackingLocationOption = { value: string; label: string; description?: string };
const isoCountryCodes = `AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS XK YE YT ZA ZM ZW`.split(" ");
const countryNames = new Intl.DisplayNames(["en"], { type: "region" });
const specialCountryNames: Record<string, string> = { BQ: "Caribbean Netherlands", CD: "Democratic Republic of the Congo", CG: "Republic of the Congo", CI: "Côte d’Ivoire", CZ: "Czechia", FM: "Micronesia", KP: "North Korea", KR: "South Korea", LA: "Laos", MD: "Moldova", MK: "North Macedonia", PS: "Palestine", RU: "Russia", SZ: "Eswatini", SY: "Syria", TL: "Timor-Leste", TW: "Taiwan", TR: "Türkiye", TZ: "Tanzania", VA: "Vatican City", XK: "Kosovo", VE: "Venezuela", VN: "Vietnam" };
export const countryOptions: TrackingLocationOption[] = isoCountryCodes.map((value) => ({ value, label: specialCountryNames[value] ?? countryNames.of(value) ?? value })).sort((a, b) => a.label.localeCompare(b.label));
const regionEntries: Array<[string, string, string]> = [
  ["MACRO_NORTH_AUSTRALASIA", "1 - The North & Australasia", "Macro-region"], ["MACRO_CENTRAL_SOUTH_AMERICA", "2 - Central & South America", "Macro-region"],
  ["MACRO_MENA", "3 - Middle East & North Africa", "Macro-region"], ["MACRO_SUBSAHARAN_AFRICA", "4 - Sub-Saharan Africa", "Macro-region"],
  ["MACRO_SOUTH_ASIA", "5 - South Asia", "Macro-region"], ["MACRO_CENTRAL_ASIA", "6 - Central Asia", "Macro-region"],
  ["MACRO_EAST_ASIA", "7 - East Asia", "Macro-region"], ["MACRO_SOUTHEAST_ASIA", "8 - Southeast Asia", "Macro-region"], ["MACRO_SOUTH_PACIFIC", "9 - South Pacific", "Macro-region"],
  ["ANGLO_WORLD", "1A - Anglo World", "Sub-region"], ["EUROPE", "1B - Europe", "Sub-region"], ["NORTH_EURASIA", "1C - North Eurasia", "Sub-region"],
  ["CARIBBEAN", "2A - The Caribbean", "Sub-region"], ["LATIN_AMERICA", "2B - Latin America", "Sub-region"], ["ATLANTIC_OCEAN", "2C - Atlantic Ocean / Cape Verde", "Sub-region"], ["INDIAN_OCEAN", "2D - Indian Ocean", "Sub-region"],
  ["ARAB_WORLD", "3A - Arab World", "Sub-region"], ["ISRAEL", "3B - Israel", "Sub-region"], ["NASTALIQ_REGION", "3C - Iran, Afghanistan & Pakistan", "Sub-region"], ["SAHEL", "3D/4A - The Sahel", "Sub-region"],
  ["TROPICAL_AFRICA", "4B - Tropical Africa", "Sub-region"], ["SOUTHERN_AFRICA", "4C - Southern Africa", "Sub-region"], ["ETHIOPIC_AFRICA", "4D - Ethiopia & Eritrea", "Sub-region"],
  ["SOUTH_ASIA", "5 - South Asia", "Sub-region"], ["CENTRAL_ASIA", "6A - Central Asia", "Sub-region"], ["MONGOLIA", "6B - Mongolia", "Sub-region"],
  ["EAST_ASIA", "7 - East Asia", "Sub-region"], ["MAINLAND_SE_ASIA", "8A - Mainland Southeast Asia", "Sub-region"], ["SINGAPORE", "8B - Singapore", "Sub-region"], ["INSULAR_SE_ASIA", "8C - Insular Southeast Asia", "Sub-region"],
  ["SOUTH_PACIFIC", "9A - South Pacific", "Sub-region"], ["EAST_TIMOR", "9B - East Timor", "Sub-region"],
];
export const regionOptions: TrackingLocationOption[] = regionEntries.map(([id, label, description]) => ({ value: "REGION:" + id, label, description }));
export const trackingRegionCountryCodes: Record<string, string[]> = {
  "REGION:ANGLO_WORLD": ["GB","AU","NZ","IE","US","CA"],
  "REGION:EUROPE": ["PL","CZ","HU","BG","RS","SK","HR","BA","MK","SI","ME","DE","FR","IT","ES","NL","BE","PT","AT","CH","LU","SE","DK","FI","NO","LT","LV","EE","GR","CY","IS","GL","RO","AL"],
  "REGION:NORTH_EURASIA": ["RU","UA","BY","GE","AM"], "REGION:CARIBBEAN": ["JM","TT","BS","GY","SR","BZ"],
  "REGION:LATIN_AMERICA": ["MX","CO","PE","VE","GT","EC","DO","HN","NI","SV","CR","PA","PR","AR","CL","UY","BO","PY","CU","BR","GF"],
  "REGION:ATLANTIC_OCEAN": ["CV"], "REGION:INDIAN_OCEAN": ["MU","RE"],
  "REGION:ARAB_WORLD": ["SA","AE","KW","OM","QA","BH","EG","IQ","SY","JO","LY","PS","MA","DZ","TN","YE","LB"], "REGION:ISRAEL": ["IL"],
  "REGION:NASTALIQ_REGION": ["IR","AF","PK"], "REGION:SAHEL": ["SD","MR","NE","ML","TD","SO","DJ"],
  "REGION:TROPICAL_AFRICA": ["CI","BF","SN","GN","BJ","TG","GM","GW","TZ","KE","UG","MW","ZM","ZW","CD","CM","CF","CG","GA","GQ","NG","GH","SL","LR","MZ","AO","RW","BI","MG","SS","HT"],
  "REGION:SOUTHERN_AFRICA": ["ZA","BW","NA","LS","SZ"], "REGION:ETHIOPIC_AFRICA": ["ET","ER"], "REGION:SOUTH_ASIA": ["IN","NP","BT","BD","LK"],
  "REGION:CENTRAL_ASIA": ["UZ","KZ","KG","TM","TR","AZ","TJ"], "REGION:MONGOLIA": ["MN"], "REGION:EAST_ASIA": ["CN","TW","JP","KR","KP"],
  "REGION:MAINLAND_SE_ASIA": ["KH","LA","MM","TH","VN"], "REGION:SINGAPORE": ["SG"], "REGION:INSULAR_SE_ASIA": ["MY","BN","ID","PH"],
  "REGION:SOUTH_PACIFIC": ["PG","SB","VU","NC","WS","PF","FJ"], "REGION:EAST_TIMOR": ["TL"],
};
const unique = (values: string[]) => [...new Set(values)];
const region = (...ids: string[]) => unique(ids.flatMap((id) => trackingRegionCountryCodes["REGION:" + id] ?? []));
Object.assign(trackingRegionCountryCodes, {
  "REGION:MACRO_NORTH_AUSTRALASIA": region("ANGLO_WORLD","EUROPE","NORTH_EURASIA"),
  "REGION:MACRO_CENTRAL_SOUTH_AMERICA": region("CARIBBEAN","LATIN_AMERICA","ATLANTIC_OCEAN","INDIAN_OCEAN"),
  "REGION:MACRO_MENA": region("ARAB_WORLD","ISRAEL","NASTALIQ_REGION","SAHEL"),
  "REGION:MACRO_SUBSAHARAN_AFRICA": region("SAHEL","TROPICAL_AFRICA","SOUTHERN_AFRICA","ETHIOPIC_AFRICA"),
  "REGION:MACRO_SOUTH_ASIA": region("SOUTH_ASIA"), "REGION:MACRO_CENTRAL_ASIA": region("CENTRAL_ASIA","MONGOLIA"),
  "REGION:MACRO_EAST_ASIA": region("EAST_ASIA"), "REGION:MACRO_SOUTHEAST_ASIA": region("MAINLAND_SE_ASIA","SINGAPORE","INSULAR_SE_ASIA"),
  "REGION:MACRO_SOUTH_PACIFIC": region("SOUTH_PACIFIC","EAST_TIMOR"),
});
export function resolveTrackingCountryCodes(selections: string[]): string[] {
  if (selections.includes("GLOBAL")) return ["GLOBAL"];
  return unique(selections.flatMap((value) => value.startsWith("REGION:") ? trackingRegionCountryCodes[value] ?? [] : /^[A-Z]{2}$/.test(value) ? [value] : []));
}
export function trackingLocationLabel(value: string): string {
  if (value === "GLOBAL") return "Global";
  return countryOptions.find((option) => option.value === value)?.label ?? regionOptions.find((option) => option.value === value)?.label ?? value;
}
export const REGIONS_REFERENCE_PDF = "https://objectivelists.com/wp-content/uploads/2022/12/AVERAGE-WORLD-REGIONS.pdf";
