import type { JobWorkMode } from "./types";

export const JOB_WORK_MODE_OPTIONS: Array<{ value: JobWorkMode; label: string }> = [
  { value: "onsite", label: "Local / in person" },
  { value: "remote", label: "Remote" },
  { value: "hybrid", label: "Hybrid" },
];

const REMOTE_FIRST_SOURCES = new Set(["remotive", "remoteok", "weworkremotely"]);
const HYBRID_PATTERN = /\b(hybrid|partly remote|partially remote|remote\/onsite|remote and onsite)\b/i;
const REMOTE_PATTERN = /\b(remote|work from home|work-from-home|wfh|anywhere)\b/i;
const NEGATED_REMOTE_PATTERN = /\b(no|not|non)\s+remote\b|\bremote\s+(not available|unavailable)\b/i;

interface WorkModeInput {
  source?: string | null;
  company?: string | null;
  location?: string | null;
  title?: string | null;
  description?: string | null;
  remote?: boolean | null;
  hybrid?: boolean | null;
}

export function isJobWorkMode(value: string | null | undefined): value is JobWorkMode {
  return value === "onsite" || value === "remote" || value === "hybrid";
}

export function formatJobWorkMode(value: JobWorkMode | string | null | undefined): string {
  return JOB_WORK_MODE_OPTIONS.find((option) => option.value === value)?.label ?? "Local / in person";
}

export function inferJobWorkMode(input: WorkModeInput): JobWorkMode {
  const text = [input.title, input.company, input.location, input.description]
    .filter(Boolean)
    .join(" ");

  if (input.hybrid || HYBRID_PATTERN.test(text)) {
    return "hybrid";
  }

  if (
    input.remote ||
    (input.source ? REMOTE_FIRST_SOURCES.has(input.source) : false) ||
    (REMOTE_PATTERN.test(text) && !NEGATED_REMOTE_PATTERN.test(text))
  ) {
    return "remote";
  }

  return "onsite";
}

export function normalizeJobWorkMode(
  value: string | null | undefined,
  fallback: WorkModeInput,
): JobWorkMode {
  return isJobWorkMode(value) ? value : inferJobWorkMode(fallback);
}
