interface JobIdentityInput {
  title: string;
  company: string;
  location: string;
  source?: string | null;
  salaryMin?: number | null;
  updatedAt?: Date | string | null;
}

export interface JobDuplicateGroup<T extends JobIdentityInput> {
  key: string;
  primary: T;
  jobs: T[];
  sources: string[];
}

const COMPANY_SUFFIXES = new Set([
  "co",
  "company",
  "corp",
  "corporation",
  "gmbh",
  "group",
  "inc",
  "incorporated",
  "llc",
  "ltd",
  "limited",
  "plc",
]);

const SOURCE_PRIORITY = [
  "usajobs",
  "greenhouse",
  "lever",
  "ashby",
  "smartrecruiters",
  "adzuna",
  "jsearch",
  "remotive",
  "remoteok",
  "weworkremotely",
  "arbeitnow",
];

const US_STATE_ABBREVIATIONS: Record<string, string> = {
  al: "alabama",
  ak: "alaska",
  az: "arizona",
  ar: "arkansas",
  ca: "california",
  co: "colorado",
  ct: "connecticut",
  de: "delaware",
  dc: "district columbia",
  fl: "florida",
  ga: "georgia",
  hi: "hawaii",
  id: "idaho",
  il: "illinois",
  in: "indiana",
  ia: "iowa",
  ks: "kansas",
  ky: "kentucky",
  la: "louisiana",
  me: "maine",
  md: "maryland",
  ma: "massachusetts",
  mi: "michigan",
  mn: "minnesota",
  ms: "mississippi",
  mo: "missouri",
  mt: "montana",
  ne: "nebraska",
  nv: "nevada",
  nh: "new hampshire",
  nj: "new jersey",
  nm: "new mexico",
  ny: "new york",
  nc: "north carolina",
  nd: "north dakota",
  oh: "ohio",
  ok: "oklahoma",
  or: "oregon",
  pa: "pennsylvania",
  ri: "rhode island",
  sc: "south carolina",
  sd: "south dakota",
  tn: "tennessee",
  tx: "texas",
  ut: "utah",
  vt: "vermont",
  va: "virginia",
  wa: "washington",
  wv: "west virginia",
  wi: "wisconsin",
  wy: "wyoming",
};

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9+#.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeTitle(value: string): string {
  return normalizeText(value)
    .replace(/\b(remote|hybrid|onsite|on site|full time|part time|contract|temporary)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeCompany(value: string): string {
  return normalizeText(value)
    .split(" ")
    .map((part) => part.replace(/\.+$/g, ""))
    .filter((part) => !COMPANY_SUFFIXES.has(part))
    .join(" ")
    .trim();
}

function normalizeLocation(value: string): string {
  const normalized = normalizeText(value);
  if (!normalized) return "";
  if (/\b(remote|anywhere|work from home|united states)\b/.test(normalized)) return "remote";

  return normalized
    .split(" ")
    .map((part) => US_STATE_ABBREVIATIONS[part] ?? part)
    .filter((part) => part !== "usa" && part !== "us")
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function updatedAtMillis(value: Date | string | null | undefined): number {
  if (!value) return 0;
  const date = value instanceof Date ? value : new Date(value);
  const time = date.getTime();
  return Number.isNaN(time) ? 0 : time;
}

function sourceRank(source: string | null | undefined): number {
  const index = SOURCE_PRIORITY.indexOf(source ?? "");
  return index === -1 ? SOURCE_PRIORITY.length : index;
}

function comparePreferredJob<T extends JobIdentityInput>(a: T, b: T): number {
  const salaryA = a.salaryMin ?? -1;
  const salaryB = b.salaryMin ?? -1;
  if (salaryA !== salaryB) return salaryB - salaryA;

  const sourceDiff = sourceRank(a.source) - sourceRank(b.source);
  if (sourceDiff !== 0) return sourceDiff;

  return updatedAtMillis(b.updatedAt) - updatedAtMillis(a.updatedAt);
}

export function jobDuplicateKey(job: JobIdentityInput): string {
  return [
    normalizeTitle(job.title),
    normalizeCompany(job.company),
    normalizeLocation(job.location),
  ].join("|");
}

export function groupDuplicateJobs<T extends JobIdentityInput>(jobs: T[]): JobDuplicateGroup<T>[] {
  const groups = new Map<string, T[]>();

  for (const job of jobs) {
    const key = jobDuplicateKey(job);
    const group = groups.get(key);
    if (group) {
      group.push(job);
    } else {
      groups.set(key, [job]);
    }
  }

  return [...groups.entries()].map(([key, groupJobs]) => {
    const sorted = [...groupJobs].sort(comparePreferredJob);
    const sources = [...new Set(groupJobs.map((job) => job.source).filter((source): source is string => !!source))]
      .sort((a, b) => sourceRank(a) - sourceRank(b));

    return {
      key,
      primary: sorted[0],
      jobs: groupJobs,
      sources,
    };
  });
}

export function dedupeJobsForDisplay<T extends JobIdentityInput>(jobs: T[]): T[] {
  return groupDuplicateJobs(jobs).map((group) => group.primary);
}
