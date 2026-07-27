import type { RiasecScores } from "@/lib/sage/discovery-extractor";

/** Shared RIASEC dimension keys — safe for client and server. */
export const RIASEC_KEYS = [
  "realistic",
  "investigative",
  "artistic",
  "social",
  "enterprising",
  "conventional",
] as const satisfies readonly (keyof RiasecScores)[];

export type RiasecKey = (typeof RIASEC_KEYS)[number];
