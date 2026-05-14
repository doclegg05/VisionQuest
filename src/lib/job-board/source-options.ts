export const DEFAULT_JOB_SOURCES = [
  "remotive",
  "remoteok",
  "weworkremotely",
  "jsearch",
] as const;

export const JOB_SOURCE_OPTIONS = [
  { value: "remotive", label: "Remotive (remote, no key)" },
  { value: "remoteok", label: "Remote OK (remote, no key)" },
  { value: "weworkremotely", label: "We Work Remotely (remote, no key)" },
  { value: "arbeitnow", label: "Arbeitnow (global, no key)" },
  { value: "greenhouse", label: "Greenhouse company boards (no key)" },
  { value: "lever", label: "Lever company boards (no key)" },
  { value: "ashby", label: "Ashby company boards (no key)" },
  { value: "smartrecruiters", label: "SmartRecruiters company boards (no key)" },
  { value: "jsearch", label: "JSearch (RapidAPI)" },
  { value: "usajobs", label: "USAJobs (Federal)" },
  { value: "adzuna", label: "Adzuna" },
] as const;

export type JobSourceKey = (typeof JOB_SOURCE_OPTIONS)[number]["value"];

export const VALID_JOB_SOURCES = JOB_SOURCE_OPTIONS.map((source) => source.value);

export function isValidJobSource(value: string): value is JobSourceKey {
  return VALID_JOB_SOURCES.includes(value as JobSourceKey);
}
