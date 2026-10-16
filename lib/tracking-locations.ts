export type TrackingLocationOption = { value: string; label: string };
const isoCountryCodes = `AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS XK YE YT ZA ZM ZW`.split(" ");
const countryNames = new Intl.DisplayNames(["en"], { type: "region" });
const specialCountryNames: Record<string, string> = { BQ: "Caribbean Netherlands", CD: "Democratic Republic of the Congo", CG: "Republic of the Congo", CI: "Côte d’Ivoire", CZ: "Czechia", FM: "Micronesia", KP: "North Korea", KR: "South Korea", LA: "Laos", MD: "Moldova", MK: "North Macedonia", PS: "Palestine", RU: "Russia", SZ: "Eswatini", SY: "Syria", TL: "Timor-Leste", TW: "Taiwan", TR: "Türkiye", TZ: "Tanzania", VA: "Vatican City", XK: "Kosovo", VE: "Venezuela", VN: "Vietnam" };
export const countryOptions: TrackingLocationOption[] = isoCountryCodes
  .map((value) => ({ value, label: specialCountryNames[value] ?? countryNames.of(value) ?? value }))
  .sort((a, b) => a.label.localeCompare(b.label));
export function trackingLocationLabel(value: string): string {
  if (value === "GLOBAL") return "Global";
  return countryOptions.find((option) => option.value === value)?.label ?? value;
}
