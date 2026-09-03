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

  // Electronic consent & signatures under FERPA 34 CFR § 99.30(d) & ESIGN Act
  ferpaConsentSigned: z.boolean().default(true).optional(),
  policyAcknowledgmentSigned: z.boolean().default(true).optional(),
  legalAffirmationSigned: z.boolean().default(true).optional(),
  signatureName: z.string().trim().max(150).optional().nullable(),
  signatureTimestamp: z.string().trim().optional().nullable(),
  signatureIp: z.string().trim().max(64).optional().nullable(),
  signatureDataUrl: z.string().trim().optional().nullable(),
  signatureMethod: z.enum(["drawn", "uploaded", "typed_affirmation"]).optional().nullable(),
  signatureAuditHash: z.string().trim().max(100).optional().nullable(),

  // Staff / Instructor Counter-Signature & Agency Clearance
  staffSignatureName: z.string().trim().max(150).optional().nullable(),
  staffSignatureTitle: z.string().trim().max(100).optional().nullable(),
  staffSignatureDataUrl: z.string().trim().optional().nullable(),
  staffSignatureTimestamp: z.string().trim().optional().nullable(),
  staffClearanceStatus: z.enum(["approved", "pending", "returned"]).optional().nullable(),
});

export type IntakePayload = z.infer<typeof intakePayloadSchema>;
