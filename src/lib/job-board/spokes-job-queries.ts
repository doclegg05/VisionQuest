import { CAREER_CLUSTERS } from "@/lib/spokes/career-clusters";

/**
 * High-demand WV entry-level titles. As of 2026-07-24 these ARE covered by
 * formal clusters (`healthcare-support`, `trades-logistics`), so they now earn
 * cluster-match points rather than relying on location + skills alone.
 *
 * The list stays because a cluster contributes only its `sampleJobs[0]` below —
 * without it, Home Health Aide, Caregiver, Medical Assistant, CDL Driver, and
 * Maintenance Technician would drop out of the search entirely. Entries that
 * duplicate a cluster's first sample job are deduped case-insensitively.
 */
const HEALTHCARE_TRADES_TITLES = [
  "Certified Nursing Assistant",
  "Home Health Aide",
  "Caregiver",
  "Medical Assistant",
  "Warehouse Associate",
  "CDL Driver",
  "Maintenance Technician",
];

/** sampleJobs that make poor search keywords. */
const SKIP_TITLE_SUBSTRINGS = ["entry-level positions"];

const MAX_QUERY_TITLES = 16;

/**
 * Titles the CareerOneStop adapter queries against the class region.
 * THE RELEVANCE LEVER. Built from the first sample job of each SPOKES cluster
 * plus a healthcare/trades supplement; deduped (case-insensitive) and capped.
 */
export function getSpokesJobQueryTitles(): string[] {
  const clusterTitles = CAREER_CLUSTERS
    .map((cluster) => cluster.sampleJobs[0])
    .filter((title): title is string => Boolean(title));

  const seen = new Set<string>();
  const titles: string[] = [];

  for (const raw of [...HEALTHCARE_TRADES_TITLES, ...clusterTitles]) {
    const title = raw.trim();
    const key = title.toLowerCase();
    if (!title || seen.has(key)) continue;
    if (SKIP_TITLE_SUBSTRINGS.some((bad) => key.includes(bad))) continue;
    seen.add(key);
    titles.push(title);
    if (titles.length >= MAX_QUERY_TITLES) break;
  }

  return titles;
}
