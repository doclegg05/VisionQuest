import { intakePayloadSchema } from "@/lib/intake/schema";

export interface IntakeStep1Fields {
  firstName: string;
  lastName: string;
  birthDate: string;
  county: string;
  phone: string;
  email: string;
}

export interface DemographicsInput {
  skip: boolean;
  gender: string;
  race: string;
  ethnicity: string;
  primaryLanguage: string;
}

export interface DemographicsPayload {
  gender: string | null;
  race: string | null;
  ethnicity: string | null;
  primaryLanguage: string;
}

const PREFER_NOT_TO_SAY = "Prefer not to say";

export function validateIntakeStep1(fields: IntakeStep1Fields): string | null {
  if (!fields.firstName.trim() || !fields.lastName.trim()) {
    return "Please enter your legal first and last name.";
  }
  if (!fields.birthDate) return "Please provide your date of birth.";
  if (!fields.county) return "Please select your West Virginia county.";
  if (!fields.phone.trim()) {
    return "Please provide a phone number where instructors can reach you.";
  }
  const email = fields.email.trim();
  if (email && !intakePayloadSchema.shape.email.safeParse(email).success) {
    return "Please enter a valid email address, or leave it blank.";
  }
  return null;
}

export function demographicsForSubmit(input: DemographicsInput): DemographicsPayload {
  if (input.skip) {
    return {
      gender: PREFER_NOT_TO_SAY,
      race: PREFER_NOT_TO_SAY,
      ethnicity: PREFER_NOT_TO_SAY,
      primaryLanguage: PREFER_NOT_TO_SAY,
    };
  }
  return {
    gender: input.gender || null,
    race: input.race || null,
    ethnicity: input.ethnicity || null,
    primaryLanguage: input.primaryLanguage || "English",
  };
}
