// =============================================================================
// The employer packet — Prisma-free half.
//
// Match & Connect Phase 4, Task 4.2. The packet is the payload that LEAVES the
// program, so this file follows the same discipline as workforce-batch.ts: a
// fixed allowlist, and a test that pins it against a denylist of the real
// field names on SpokesRecord / StudentWorkProfile / Student, so a later
// "just add the county" fails a test by name rather than shipping.
//
// Owner decision D1 (design spec §12.1), RECOMMENDED default, is what this
// list implements: tailored résumé PDF, verified certifications, availability
// and earliest start, the instructor endorsement, and the subsidy line.
// NOT included: contact details beyond what the résumé itself carries,
// benefits status, any narrative about barriers, and — per the spec §5
// guardrail — any score, rank or comparison.
//
// This module must never import @/lib/db: the student approval card renders
// the field list before anything is sent.
// =============================================================================

import { z } from "zod";

/**
 * Every field a packet may ever contain, in the order the student sees them.
 * Adding one is a deliberate act with a test to update and, because it changes
 * what a disclosure contains, a consent question to re-ask.
 */
export const PACKET_FIELD_KEYS = [
  "candidate_name",
  "resume",
  "verified_certifications",
  "availability",
  "earliest_start",
  "endorsement",
  "subsidy_line",
] as const;

export type PacketFieldKey = (typeof PACKET_FIELD_KEYS)[number];

/**
 * What the student is told each field means, at a 6th-grade reading level.
 * These strings are the informed half of informed consent — they are shown on
 * the approval card before the tap that sends anything.
 */
export const PACKET_FIELD_LABELS: Record<PacketFieldKey, string> = {
  candidate_name: "Your first name and the first letter of your last name",
  resume: "Your résumé, written for this job",
  verified_certifications: "The cards you earned that a teacher checked",
  availability: "The days and times you can work",
  earliest_start: "The soonest day you can start",
  endorsement: "What your teacher wrote about your work",
  subsidy_line: "A note about money the employer may get for hiring",
};

export interface PacketFieldDescriptor {
  key: PacketFieldKey;
  label: string;
}

export const PACKET_FIELDS: readonly PacketFieldDescriptor[] = PACKET_FIELD_KEYS.map(
  (key) => ({ key, label: PACKET_FIELD_LABELS[key] }),
);

/**
 * What the packet says when no subsidy figure has been verified.
 *
 * Deliberately carries no number and no program name. Every figure in
 * subsidies-shared.ts is UNVERIFIED until the local WV Works office signs it
 * off (plan P0.8), and an unverified benefits number on a page an employer
 * reads is exactly the kind of thing this program cannot take back.
 */
export const SUBSIDY_FALLBACK_LINE = "Ask us about money for hiring.";

export const packetFieldKeySchema = z.enum(PACKET_FIELD_KEYS);

/**
 * The frozen packet, stored on `Connection.packet` at approval time.
 *
 * `includedFields` is what the student actually approved and is the ONLY list
 * the employer page and the /memory disclosure log read. The value fields
 * beside it are the frozen content, so a résumé edited after approval does not
 * silently change what was sent.
 */
export const packetSchema = z
  .object({
    resumeVersionId: z.string().min(1).nullable(),
    coverLetterId: z.string().min(1).nullable(),
    /** The rendered PDF in storage, once one exists. */
    resumeFileUploadId: z.string().min(1).nullable(),
    endorsement: z.string().max(2000),
    includedCertIds: z.array(z.string().min(1)).max(50),
    includedFields: z.array(packetFieldKeySchema).min(1).max(PACKET_FIELD_KEYS.length),
    candidateName: z.string().min(1).max(120),
    certifications: z.array(z.string().min(1).max(200)).max(50),
    availabilitySummary: z.string().max(400),
    earliestStart: z.string().max(40).nullable(),
    subsidyLine: z.string().max(600).nullable(),
  })
  .strict();

export type Packet = z.infer<typeof packetSchema>;

/** Parse an unknown `Connection.packet` JSON column, or null when it is not one. */
export function parsePacket(value: unknown): Packet | null {
  const result = packetSchema.safeParse(value);
  return result.success ? result.data : null;
}

/** The exact list shown to the student before approval, and again on /memory. */
export function packetFieldList(packet: Packet): string[] {
  return packet.includedFields.map((key) => PACKET_FIELD_LABELS[key]);
}

/**
 * "Dana R." — first name plus last initial, never the full surname.
 *
 * The employer learns the candidate's full name at the interview the
 * instructor arranges, not from a link that could be forwarded anywhere. A
 * single-word name is passed through as-is (there is no initial to take), and
 * an empty one becomes a neutral placeholder rather than a blank line.
 */
export function candidateDisplayName(displayName: string): string {
  const parts = displayName.trim().split(/\s+/u).filter(Boolean);
  if (parts.length === 0) return "A SPOKES student";
  // A display name that contains an address is not a name. Some accounts are
  // created with an email in the field, and abbreviating "dana@example.com"
  // to "dana@example.com" would put a contact address on the employer page
  // under a label that promises only a first name.
  if (parts.some((part) => part.includes("@"))) return "A SPOKES student";
  if (parts.length === 1) return parts[0];
  const last = parts[parts.length - 1];
  return `${parts[0]} ${last.charAt(0).toUpperCase()}.`;
}
