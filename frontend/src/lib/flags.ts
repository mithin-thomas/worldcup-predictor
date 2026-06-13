// Maps a team's 3-letter FIFA code to a flag-icons key (ISO 3166-1 alpha-2,
// plus the gb-* subdivisions). Returns null for playoff placeholders / unknown
// codes, so the UI can show a neutral mark instead of a wrong flag.
const FIFA_TO_ISO: Record<string, string> = {
  MEX: "mx", RSA: "za", KOR: "kr", CAN: "ca", QAT: "qa", SUI: "ch",
  BRA: "br", MAR: "ma", HAI: "ht", SCO: "gb-sct", USA: "us", PAR: "py",
  AUS: "au", GER: "de", CUR: "cw", CIV: "ci", ECU: "ec", NED: "nl",
  JPN: "jp", TUN: "tn", BEL: "be", EGY: "eg", IRN: "ir", NZL: "nz",
  ESP: "es", CPV: "cv", KSA: "sa", URU: "uy", FRA: "fr", SEN: "sn",
  NOR: "no", ARG: "ar", ALG: "dz", AUT: "at", JOR: "jo", POR: "pt",
  UZB: "uz", COL: "co", ENG: "gb-eng", CRO: "hr", GHA: "gh", PAN: "pa",
};

// flagClass returns the flag-icons class for a FIFA code, or null if there is
// no known flag (playoff placeholder, qualifier TBD).
export function flagClass(code: string | undefined): string | null {
  if (!code) return null;
  const iso = FIFA_TO_ISO[code.toUpperCase()];
  return iso ? `fi fi-${iso}` : null;
}
