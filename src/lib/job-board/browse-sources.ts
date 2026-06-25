import { ALL_JOB_SOURCE_ADAPTERS } from "./adapters/registry";
import type { JobSourceAdapter } from "./types";

/** Keyless sources that power the program-wide browse pool (no API keys). */
export const BROWSE_SOURCES = [
  "remotive",
  "remoteok",
  "weworkremotely",
  "arbeitnow",
  "greenhouse",
  "lever",
  "ashby",
  "smartrecruiters",
] as const;

const BROWSE_SET = new Set<string>(BROWSE_SOURCES);

export function browseAdapters(): JobSourceAdapter[] {
  return ALL_JOB_SOURCE_ADAPTERS.filter(
    (a) => BROWSE_SET.has(a.source) && a.isConfigured(),
  );
}
