export const DEFAULT_JOB_SOURCES = [
  "careeronestop",
  "usajobs",
  "adzuna",
] as const;

export const JOB_SOURCE_OPTIONS = [
  { value: "careeronestop", label: "WV Local Jobs — state job bank", sourceMode: "local" },
  { value: "remotive", label: "Remotive (remote, no key)", sourceMode: "remote" },
  { value: "remoteok", label: "Remote OK (remote, no key)", sourceMode: "remote" },
  { value: "weworkremotely", label: "We Work Remotely (remote, no key)", sourceMode: "remote" },
  { value: "arbeitnow", label: "Arbeitnow (global, no key)", sourceMode: "mixed" },
  { value: "greenhouse", label: "Greenhouse company boards (no key)", sourceMode: "mixed" },
  { value: "lever", label: "Lever company boards (no key)", sourceMode: "mixed" },
  { value: "ashby", label: "Ashby company boards (no key)", sourceMode: "mixed" },
  { value: "smartrecruiters", label: "SmartRecruiters company boards (no key)", sourceMode: "mixed" },
  { value: "jsearch", label: "JSearch (RapidAPI)", sourceMode: "local" },
  { value: "usajobs", label: "USAJobs (Federal)", sourceMode: "local" },
  { value: "adzuna", label: "Adzuna", sourceMode: "local" },
] as const;

export type JobSourceKey = (typeof JOB_SOURCE_OPTIONS)[number]["value"];
export type JobSourceMode = (typeof JOB_SOURCE_OPTIONS)[number]["sourceMode"];

export const VALID_JOB_SOURCES = JOB_SOURCE_OPTIONS.map((source) => source.value);

export function isValidJobSource(value: string): value is JobSourceKey {
  return VALID_JOB_SOURCES.includes(value as JobSourceKey);
}

export function getJobSourceMode(value: string): JobSourceMode {
  return JOB_SOURCE_OPTIONS.find((source) => source.value === value)?.sourceMode ?? "mixed";
}
