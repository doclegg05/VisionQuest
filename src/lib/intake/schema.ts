import { z } from "zod";
import { WV_COUNTIES } from "@/lib/spokes/student-profile-form";

export const INTAKE_EDUCATIONAL_LEVELS = [
  "Grades 1-8",
  "Grades 9-12 (no diploma)",
  "High school diploma",
  "High school equivalency (GED/HSE)",
  "Some college",
  "Postsecondary degree or certificate",
] as const;

export const INTAKE_HOUSEHOLD_TYPES = [
  "Single parent (1P)",
  "Two parent (2P)",
] as const;

export const INTAKE_GENDERS = [
  "Female",
  "Male",
  "Nonbinary",
  "Prefer not to say",
] as const;

export const INTAKE_RACE_OPTIONS = [
  "American Indian or Alaska Native",
  "Asian",
  "Black or African American",
  "Native Hawaiian or Other Pacific Islander",
  "White",
  "Two or more races",
  "Prefer not to say",
] as const;

export const INTAKE_ETHNICITY_OPTIONS = [
  "Hispanic or Latino",
  "Not Hispanic or Latino",
  "Prefer not to say",
] as const;

export const INTAKE_PRIMARY_LANGUAGES = [
  "English",
  "Spanish",
  "Other",
  "Prefer not to say",
] as const;

export const INTAKE_SIGNATURE_METHODS = ["drawn", "uploaded", "typed_affirmation"] as const;
export type IntakeSignatureMethod = (typeof INTAKE_SIGNATURE_METHODS)[number];

// --- Signature images -----------------------------------------------------------
// `/api/intake/submit` is unauthenticated, and a signature image travels through it
// straight into pdf-lib's PNG/JPEG decoders. Both the encoded size and the declared
// type are bounded here so an anonymous caller cannot buffer, decode and parse an
// arbitrarily large image (`.claude/rules/security.md`, Input Validation).

/** A signature is a few strokes; half a megabyte is already generous. */
export const SIGNATURE_IMAGE_MAX_BYTES = 512 * 1024;

export const SIGNATURE_IMAGE_MIME_TYPES = ["image/png", "image/jpeg"] as const;
export type SignatureImageMimeType = (typeof SIGNATURE_IMAGE_MIME_TYPES)[number];

/** Base64 costs 4 characters per 3 bytes; the header adds a couple of dozen more. */
export const SIGNATURE_DATA_URL_MAX_CHARS = Math.ceil(SIGNATURE_IMAGE_MAX_BYTES / 3) * 4 + 64;

const SIGNATURE_DATA_URL_PATTERN =
  /^data:(image\/png|image\/jpeg);base64,([A-Za-z0-9+/]+={0,2})$/;

export interface ParsedSignatureImage {
  /** Read from the data-URL header — never sniffed out of the payload. */
  mimeType: SignatureImageMimeType;
  base64: string;
  byteLength: number;
}

function base64ByteLength(base64: string): number {
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return (base64.length * 3) / 4 - padding;
}

/**
 * Validate a signature data URL and report its declared type and decoded size.
 * Returns null for anything that is not an in-budget PNG or JPEG data URL, so a
 * caller can neither be steered into the wrong decoder nor handed an unbounded
 * buffer.
 */
export function parseSignatureImageDataUrl(
  value: string | null | undefined,
): ParsedSignatureImage | null {
  if (typeof value !== "string") return null;

  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > SIGNATURE_DATA_URL_MAX_CHARS) return null;

  const match = SIGNATURE_DATA_URL_PATTERN.exec(trimmed);
  if (!match) return null;

  const base64 = match[2];
  if (base64.length % 4 !== 0) return null;

  const byteLength = base64ByteLength(base64);
  if (byteLength <= 0 || byteLength > SIGNATURE_IMAGE_MAX_BYTES) return null;

  return { mimeType: match[1] as SignatureImageMimeType, base64, byteLength };
}

const signatureDataUrlSchema = z
  .string()
  .trim()
  .max(
    SIGNATURE_DATA_URL_MAX_CHARS,
    "Signature image is too large. Please use a smaller PNG or JPEG.",
  )
  .refine(
    (value) => parseSignatureImageDataUrl(value) !== null,
    "Signature must be a PNG or JPEG image of 512 KB or less.",
  );

// --- Server-controlled fields ---------------------------------------------------
// Signing time, source IP, the document digest and the instructor counter-signature
// are all attestations ABOUT the submitter. Accepting them from the submitter's own
// request body let an anonymous POST forge an instructor sign-off and dictate its
// own audit trail. They are rejected here and derived server-side instead; the
// packet generator takes the staff counter-signature as an explicit argument on an
// authenticated path (see `StaffCounterSignature` in ./pdf-stamped-packet).

export const SERVER_DERIVED_INTAKE_FIELDS = [
  "signatureTimestamp",
  "signatureIp",
  "signatureAuditHash",
  "staffSignatureName",
  "staffSignatureTitle",
  "staffSignatureDataUrl",
  "staffSignatureTimestamp",
  "staffClearanceStatus",
] as const;

export type ServerDerivedIntakeField = (typeof SERVER_DERIVED_INTAKE_FIELDS)[number];

const rejectedField = (reason: string) => z.never({ message: reason }).optional();

const SERVER_DERIVED_FIELD_SCHEMAS = {
  signatureTimestamp: rejectedField("Signing time is recorded from the server clock."),
  signatureIp: rejectedField("Source IP is recorded from the connection."),
  signatureAuditHash: rejectedField("The document digest is computed from the signed packet."),
  staffSignatureName: rejectedField("Only signed-in program staff can counter-sign."),
  staffSignatureTitle: rejectedField("Only signed-in program staff can counter-sign."),
  staffSignatureDataUrl: rejectedField("Only signed-in program staff can counter-sign."),
  staffSignatureTimestamp: rejectedField("Only signed-in program staff can counter-sign."),
  staffClearanceStatus: rejectedField("Clearance is granted by staff review, not by the submitter."),
} satisfies Record<ServerDerivedIntakeField, z.ZodType>;

export const intakePayloadSchema = z.object({
  firstName: z.string().trim().min(1, "First name is required.").max(100),
  middleName: z.string().trim().max(100).optional().nullable(),
  lastName: z.string().trim().min(1, "Last name is required.").max(100),
  preferredName: z.string().trim().max(100).optional().nullable(),
  email: z.string().trim().email("Invalid email address.").optional().nullable(),
  phone: z.string().trim().max(30).optional().nullable(),
  streetAddress: z.string().trim().max(200).optional().nullable(),
  city: z.string().trim().max(100).optional().nullable(),
  zipCode: z.string().trim().max(20).optional().nullable(),
  birthDate: z
    .string()
    .trim()
    .refine((val) => !Number.isNaN(Date.parse(val)), {
      message: "Valid birth date (YYYY-MM-DD) is required.",
    }),
  county: z.enum(WV_COUNTIES, {
    message: "A valid West Virginia county is required.",
  }),
  householdType: z.enum(INTAKE_HOUSEHOLD_TYPES).optional().nullable(),
  gender: z.enum(INTAKE_GENDERS).optional().nullable(),
  race: z.string().trim().max(100).optional().nullable(),
  ethnicity: z.string().trim().max(100).optional().nullable(),
  primaryLanguage: z.string().trim().max(50).optional().nullable(),
  educationalLevel: z.enum(INTAKE_EDUCATIONAL_LEVELS).optional().nullable(),
  programTrack: z.string().trim().max(100).optional().nullable(),
  tanfStatus: z.boolean().optional().default(false),
  assistanceStatus: z.string().trim().max(50).optional().nullable(),
  caseNumber: z.string().trim().max(50).optional().nullable(),
  emergencyContactName: z.string().trim().max(100).optional().nullable(),
  emergencyContactPhone: z.string().trim().max(30).optional().nullable(),
  emergencyContactRelation: z.string().trim().max(50).optional().nullable(),
  requiredParticipationHours: z.number().int().min(0).max(100).optional().nullable(),
  referralSource: z.string().trim().max(150).optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),

  // Optional target class ID; if omitted, automatically resolved by county
  classId: z.string().trim().optional().nullable(),

  // Electronic consent & signatures under FERPA 34 CFR § 99.30(d) & ESIGN Act.
  // This packet authorizes disclosure of a TANF/SNAP participant's education
  // records to DoHS, WorkForce WV and instructional staff, so the consent has to
  // arrive as an affirmative act. It is never defaulted and never inferred.
  ferpaConsentSigned: z.literal(true, {
    message: "FERPA release consent must be given before the intake can be submitted.",
  }),
  policyAcknowledgmentSigned: z.literal(true, {
    message: "The program policy acknowledgment must be accepted before submitting.",
  }),
  legalAffirmationSigned: z.boolean().optional(),
  signatureName: z.string().trim().max(150).optional().nullable(),
  signatureDataUrl: signatureDataUrlSchema.optional().nullable(),
  signatureMethod: z.enum(INTAKE_SIGNATURE_METHODS).optional().nullable(),

  ...SERVER_DERIVED_FIELD_SCHEMAS,
});

/** Exactly what a self-submitted intake request may contain. */
export type SelfSubmittedIntakePayload = z.infer<typeof intakePayloadSchema>;

/** Consent as it was recorded, which for a regenerated packet may be nothing. */
export interface RecordedIntakeConsent {
  ferpaConsentSigned?: boolean;
  policyAcknowledgmentSigned?: boolean;
  legalAffirmationSigned?: boolean;
}

/**
 * Attestation fields that server-side call sites still pass inline.
 *
 * Every one of them is REJECTED by `intakePayloadSchema` and IGNORED by the packet
 * generator: signing time comes from the server clock, the source IP from the
 * connection, the digest from the finished PDF bytes, and the counter-signature
 * from `StaffCounterSignature` on an authenticated staff path. They survive here
 * only so pre-hardening call sites keep type-checking; delete this interface once
 * every call site passes `StampedPacketOptions` instead.
 *
 * @deprecated Pass `StampedPacketOptions` to the packet generator.
 */
export interface LegacyIgnoredPacketFields {
  /** @deprecated Ignored — the server clock is authoritative. */
  signatureTimestamp?: string | null;
  /** @deprecated Ignored — the source IP is read from the connection. */
  signatureIp?: string | null;
  /** @deprecated Ignored — the digest is computed over the finished PDF. */
  signatureAuditHash?: string | null;
  /** @deprecated Ignored — pass `staffCounterSignature`. */
  staffSignatureName?: string | null;
  /** @deprecated Ignored — pass `staffCounterSignature`. */
  staffSignatureTitle?: string | null;
  /** @deprecated Ignored — pass `staffCounterSignature`. */
  staffSignatureDataUrl?: string | null;
  /** @deprecated Ignored — pass `staffCounterSignature`. */
  staffSignatureTimestamp?: string | null;
  /** @deprecated Ignored — clearance follows the staff counter-signature. */
  staffClearanceStatus?: "approved" | "pending" | "returned" | null;
}

/**
 * The intake record as server code handles it: the self-submitted fields, plus
 * whatever consent was actually recorded, plus the deprecated slots above.
 */
export type IntakePayload = Omit<
  SelfSubmittedIntakePayload,
  ServerDerivedIntakeField | keyof RecordedIntakeConsent
> &
  RecordedIntakeConsent &
  LegacyIgnoredPacketFields;
