// =============================================================================
// National Career Clusters → SPOKES Pathway Mapping
//
// The modernized National Career Clusters Framework (Advance CTE, Oct 2024) —
// 14 clusters, replacing the retired 16-cluster framework. Names and
// punctuation verified against https://careertech.org/career-clusters/
// (the framework uses serial commas: "Arts, Entertainment, & Design").
//
// Three of the 14 are designated cross-cutting clusters (they intersect all
// others but are full members of the list): Digital Technology,
// Marketing & Sales, and Management & Entrepreneurship.
//
// Stored student data (CareerDiscovery.nationalClusters) may still carry
// retired 16-framework names. Those rows are normalized at READ time via
// normalizeNationalClusterName / normalizeNationalClusterScores below, and
// rewritten in place by scripts/backfill-national-clusters.mjs.
// =============================================================================

export const NATIONAL_CAREER_CLUSTERS = [
  "Advanced Manufacturing",
  "Agriculture",
  "Arts, Entertainment, & Design",
  "Construction",
  "Digital Technology",
  "Education",
  "Energy & Natural Resources",
  "Financial Services",
  "Healthcare & Human Services",
  "Hospitality, Events, & Tourism",
  "Management & Entrepreneurship",
  "Marketing & Sales",
  "Public Service & Safety",
  "Supply Chain & Transportation",
] as const;

export type NationalCluster = (typeof NATIONAL_CAREER_CLUSTERS)[number];

/**
 * SPOKES pathway ids per cluster, derived from the retired 16-cluster map:
 * where two retired clusters merged into one new cluster, their SPOKES ids
 * are unioned. Energy & Natural Resources is new in the 14-framework and has
 * no dedicated SPOKES pathway, so it follows the trades-adjacent convention
 * (Construction, Advanced Manufacturing) of mapping to career-readiness.
 */
export const NATIONAL_TO_SPOKES_MAP: Record<NationalCluster, string[]> = {
  "Advanced Manufacturing": ["career-readiness"],
  "Agriculture": ["career-readiness"],
  "Arts, Entertainment, & Design": ["creative-design"],
  "Construction": ["career-readiness"],
  "Digital Technology": ["tech-digital"],
  "Education": ["customer-service", "career-readiness"],
  "Energy & Natural Resources": ["career-readiness"],
  "Financial Services": ["finance-bookkeeping"],
  "Healthcare & Human Services": ["career-readiness", "customer-service", "language-esl"],
  "Hospitality, Events, & Tourism": ["customer-service"],
  "Management & Entrepreneurship": ["office-admin", "finance-bookkeeping"],
  "Marketing & Sales": ["creative-design", "customer-service"],
  "Public Service & Safety": ["office-admin", "career-readiness"],
  "Supply Chain & Transportation": ["career-readiness"],
};

/**
 * Crosswalk from the retired 16-cluster framework to the modernized 14.
 *
 * STEM is the one judgment call: the 2024 framework dissolved "Science,
 * Technology, Engineering & Mathematics" across all clusters rather than
 * renaming it. Digital Technology is our chosen coarse home because every
 * SPOKES-relevant STEM signal we score routes through the tech-digital
 * pathway (the retired STEM cluster's only SPOKES mapping).
 */
export const LEGACY_NATIONAL_CLUSTER_MAP: Record<string, NationalCluster> = {
  "Agriculture, Food & Natural Resources": "Agriculture",
  "Architecture & Construction": "Construction",
  "Arts, A/V Technology & Communications": "Arts, Entertainment, & Design",
  "Business Management & Administration": "Management & Entrepreneurship",
  "Education & Training": "Education",
  "Finance": "Financial Services",
  "Government & Public Administration": "Public Service & Safety",
  "Health Science": "Healthcare & Human Services",
  "Hospitality & Tourism": "Hospitality, Events, & Tourism",
  "Human Services": "Healthcare & Human Services",
  "Information Technology": "Digital Technology",
  "Law, Public Safety, Corrections & Security": "Public Service & Safety",
  "Manufacturing": "Advanced Manufacturing",
  "Marketing": "Marketing & Sales",
  "Science, Technology, Engineering & Mathematics": "Digital Technology",
  "Transportation, Distribution & Logistics": "Supply Chain & Transportation",
};

/**
 * Collapse punctuation/spelling variants to one lookup key: lowercase,
 * "&" and "and" equivalent, commas ignored (serial-comma tolerance),
 * whitespace collapsed.
 */
function clusterLookupKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/,/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const CLUSTER_LOOKUP: ReadonlyMap<string, NationalCluster> = (() => {
  const lookup = new Map<string, NationalCluster>();
  for (const cluster of NATIONAL_CAREER_CLUSTERS) {
    lookup.set(clusterLookupKey(cluster), cluster);
  }
  for (const [legacy, replacement] of Object.entries(LEGACY_NATIONAL_CLUSTER_MAP)) {
    lookup.set(clusterLookupKey(legacy), replacement);
  }
  return lookup;
})();

/**
 * Resolve any current name, retired 16-framework name, or punctuation /
 * whitespace / ampersand variant of either to its canonical modernized
 * cluster. Returns null for names outside both frameworks.
 */
export function normalizeNationalClusterName(name: string): NationalCluster | null {
  const key = clusterLookupKey(name);
  if (!key) return null;
  return CLUSTER_LOOKUP.get(key) ?? null;
}

export interface NationalClusterScoreEntry {
  cluster_name: string;
  score: number;
  spokes_mapping?: string[];
}

/**
 * Read-time normalization for stored cluster-score entries
 * (CareerDiscovery.nationalClusters):
 * - known names (current, retired, or a punctuation variant of either) are
 *   rewritten to the canonical modernized name;
 * - entries that normalize to the same cluster merge: MAX score, SPOKES
 *   mapping union, first-appearance order;
 * - unknown names pass through unchanged — read paths never destroy stored
 *   student data (the write boundary in discovery-extractor.ts is where
 *   unknown names are rejected).
 */
export function normalizeNationalClusterScores<T extends NationalClusterScoreEntry>(
  entries: readonly T[],
): T[] {
  const merged = new Map<string, T>();
  for (const entry of entries) {
    const canonical = normalizeNationalClusterName(entry.cluster_name);
    const name = canonical ?? entry.cluster_name;
    const existing = merged.get(name);
    if (!existing) {
      merged.set(name, { ...entry, cluster_name: name });
      continue;
    }
    const spokesUnion =
      existing.spokes_mapping || entry.spokes_mapping
        ? [...new Set([...(existing.spokes_mapping ?? []), ...(entry.spokes_mapping ?? [])])]
        : undefined;
    merged.set(name, {
      ...existing,
      score: Math.max(existing.score, entry.score),
      ...(spokesUnion ? { spokes_mapping: spokesUnion } : {}),
    });
  }
  return [...merged.values()];
}

function isClusterScoreEntry(value: unknown): value is NationalClusterScoreEntry {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.cluster_name === "string" &&
    (candidate.score === undefined || typeof candidate.score === "number") &&
    (candidate.spokes_mapping === undefined || Array.isArray(candidate.spokes_mapping))
  );
}

/**
 * Parse a stored CareerDiscovery.nationalClusters JSON string defensively and
 * normalize it. Malformed JSON, non-array payloads, and malformed entries
 * yield [] / are dropped — mirrors the safeJsonParse convention of the
 * consuming routes.
 */
export function parseAndNormalizeStoredNationalClusters(
  raw: string | null,
): NationalClusterScoreEntry[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return normalizeNationalClusterScores(
    parsed.filter(isClusterScoreEntry).map((entry) => ({
      ...entry,
      score: typeof entry.score === "number" ? entry.score : 0,
    })),
  );
}

/**
 * String-in/string-out variant for callers that embed the stored JSON blob
 * directly (e.g. AI grounding text). Unparseable input is returned unchanged
 * so this can never invent content; null stays null.
 */
export function normalizeStoredNationalClustersJson(raw: string | null): string | null {
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return raw;
  } catch {
    return raw;
  }
  return JSON.stringify(parseAndNormalizeStoredNationalClusters(raw));
}

export function formatNationalClustersForPrompt(): string {
  const lines = [
    "NATIONAL CAREER CLUSTERS (14 standard clusters — score only those relevant):",
  ];

  for (const cluster of NATIONAL_CAREER_CLUSTERS) {
    const spokesIds = NATIONAL_TO_SPOKES_MAP[cluster];
    lines.push(`- ${cluster} → SPOKES pathways: [${spokesIds.join(", ")}]`);
  }

  return lines.join("\n");
}
