import type { Answers, FormTemplateSchema } from "@/lib/forms/schema";

/**
 * The in-browser SPOKES Student Profile — single source of truth for the
 * orientation wizard's profile step, the seeded official FormTemplate
 * (scripts/seed-data.mjs), and the /api/settings/profile field mapping.
 *
 * Scope: student-appropriate, self-reported SpokesRecord fields only.
 * Reporting/milestone fields (status, enrollment dates, wages, barriers,
 * participation hours) stay teacher-only via /api/teacher/students/[id]/spokes.
 */

export const STUDENT_PROFILE_TEMPLATE_ID = "seed-form-student-profile";
export const STUDENT_PROFILE_TEMPLATE_TITLE = "SPOKES Student Profile";
export const STUDENT_PROFILE_TEMPLATE_DESCRIPTION =
  "Personal information, background, and contact details collected during orientation.";

export const WV_COUNTIES = [
  "Barbour", "Berkeley", "Boone", "Braxton", "Brooke", "Cabell", "Calhoun",
  "Clay", "Doddridge", "Fayette", "Gilmer", "Grant", "Greenbrier", "Hampshire",
  "Hancock", "Hardy", "Harrison", "Jackson", "Jefferson", "Kanawha", "Lewis",
  "Lincoln", "Logan", "Marion", "Marshall", "Mason", "McDowell", "Mercer",
  "Mineral", "Mingo", "Monongalia", "Monroe", "Morgan", "Nicholas", "Ohio",
  "Pendleton", "Pleasants", "Pocahontas", "Preston", "Putnam", "Raleigh",
  "Randolph", "Ritchie", "Roane", "Summers", "Taylor", "Tucker", "Tyler",
  "Upshur", "Wayne", "Webster", "Wetzel", "Wirt", "Wood", "Wyoming",
] as const;

const PREFER_NOT_TO_SAY = "Prefer not to say";

export const STUDENT_PROFILE_FIELDS: FormTemplateSchema = [
  { type: "text", key: "first_name", label: "First name", required: true, maxLength: 100 },
  { type: "text", key: "last_name", label: "Last name", required: true, maxLength: 100 },
  { type: "date", key: "birth_date", label: "Date of birth", required: true },
  {
    type: "select",
    key: "county",
    label: "County",
    required: true,
    helpText: "The West Virginia county where you live.",
    options: [...WV_COUNTIES],
  },
  {
    type: "select",
    key: "household_type",
    label: "Household type",
    required: false,
    options: ["Single parent (1P)", "Two parent (2P)"],
  },
  {
    type: "select",
    key: "gender",
    label: "Gender",
    required: false,
    options: ["Female", "Male", "Nonbinary", PREFER_NOT_TO_SAY],
  },
  {
    type: "select",
    key: "race",
    label: "Race",
    required: false,
    options: [
      "American Indian or Alaska Native",
      "Asian",
      "Black or African American",
      "Native Hawaiian or Other Pacific Islander",
      "White",
      "Two or more races",
      PREFER_NOT_TO_SAY,
    ],
  },
  {
    type: "select",
    key: "ethnicity",
    label: "Ethnicity",
    required: false,
    options: ["Hispanic or Latino", "Not Hispanic or Latino", PREFER_NOT_TO_SAY],
  },
  {
    type: "select",
    key: "educational_level",
    label: "Highest education completed",
    required: false,
    options: [
      "Grades 1-8",
      "Grades 9-12 (no diploma)",
      "High school diploma",
      "High school equivalency (GED/HSE)",
      "Some college",
      "Postsecondary degree or certificate",
    ],
  },
  {
    type: "text",
    key: "contact_email",
    label: "Email address",
    required: false,
    maxLength: 200,
    helpText: "Where the program can reach you outside of class.",
  },
];

/**
 * SpokesRecord columns a student may write through this form. birth_date is
 * intentionally absent — the route parses and range-checks it separately
 * (same rules as the legacy birthDate prompt).
 */
const ANSWER_KEY_TO_SPOKES_COLUMN = {
  first_name: "firstName",
  last_name: "lastName",
  county: "county",
  household_type: "householdType",
  gender: "gender",
  race: "race",
  ethnicity: "ethnicity",
  educational_level: "educationalLevel",
  contact_email: "referralEmail",
} as const;

export type StudentProfileColumnData = Partial<
  Record<(typeof ANSWER_KEY_TO_SPOKES_COLUMN)[keyof typeof ANSWER_KEY_TO_SPOKES_COLUMN], string>
>;

/**
 * Map validated answers to SpokesRecord column values. Only whitelisted keys
 * come through — anything else in the payload is ignored, so a hostile client
 * cannot reach status/milestone/wage columns from here.
 */
export function studentProfileAnswersToColumns(answers: Answers): StudentProfileColumnData {
  const data: Record<string, string> = {};
  for (const [answerKey, column] of Object.entries(ANSWER_KEY_TO_SPOKES_COLUMN)) {
    const value = answers[answerKey];
    if (typeof value === "string" && value.length > 0) {
      data[column] = value;
    }
  }
  return data as StudentProfileColumnData;
}

/** Reverse mapping for form prefill: SpokesRecord columns → answer keys. */
export function spokesColumnsToStudentProfileAnswers(
  record: Partial<Record<string, unknown>> | null,
): Answers {
  if (!record) return {};
  const answers: Answers = {};
  for (const [answerKey, column] of Object.entries(ANSWER_KEY_TO_SPOKES_COLUMN)) {
    const value = record[column];
    if (typeof value === "string" && value.length > 0) {
      answers[answerKey] = value;
    }
  }
  return answers;
}
