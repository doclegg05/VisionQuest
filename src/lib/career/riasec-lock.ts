/**
 * Formal Interest Profiler sources that chat discovery must not overwrite.
 */

export const FORMAL_RIASEC_SOURCES = ["onet_mini_ip", "manual_entry"] as const;

export type FormalRiasecSource = (typeof FORMAL_RIASEC_SOURCES)[number];

export type RiasecSource = FormalRiasecSource | "sage_chat";

export function isFormalRiasecSource(source: string | null | undefined): source is FormalRiasecSource {
  return (
    source === "onet_mini_ip" ||
    source === "manual_entry"
  );
}

/** True when CareerDiscovery already holds a formal (non-chat) RIASEC write. */
export function isFormalRiasecLocked(discovery: {
  riasecSource?: string | null;
} | null | undefined): boolean {
  return isFormalRiasecSource(discovery?.riasecSource ?? null);
}
