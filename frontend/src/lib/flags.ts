// Maps a team's 3-letter FIFA code to a flag-icons key (ISO 3166-1 alpha-2,
// plus the gb-* subdivisions). Returns null for knockout placeholders / unknown
// codes, so the UI can show a neutral mark instead of a wrong flag.
// Kept in sync with scripts/gen_fixtures.py (the 48 World Cup 2026 teams).
const FIFA_TO_ISO: Record<string, string> = {
  MEX: "mx", RSA: "za", KOR: "kr", CZE: "cz",
  BIH: "ba", CAN: "ca", QAT: "qa", SUI: "ch",
  BRA: "br", HAI: "ht", MAR: "ma", SCO: "gb-sct",
  AUS: "au", PAR: "py", TUR: "tr", USA: "us",
  CUW: "cw", ECU: "ec", GER: "de", CIV: "ci",
  JPN: "jp", NED: "nl", SWE: "se", TUN: "tn",
  BEL: "be", EGY: "eg", IRN: "ir", NZL: "nz",
  CPV: "cv", KSA: "sa", ESP: "es", URU: "uy",
  FRA: "fr", IRQ: "iq", NOR: "no", SEN: "sn",
  ALG: "dz", ARG: "ar", AUT: "at", JOR: "jo",
  COL: "co", COD: "cd", POR: "pt", UZB: "uz",
  CRO: "hr", ENG: "gb-eng", GHA: "gh", PAN: "pa",
};

// flagClass returns the flag-icons class for a FIFA code, or null if there is
// no known flag (knockout placeholder, qualifier TBD).
export function flagClass(code: string | undefined): string | null {
  if (!code) return null;
  const iso = FIFA_TO_ISO[code.toUpperCase()];
  return iso ? `fi fi-${iso}` : null;
}
