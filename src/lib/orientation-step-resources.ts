import { getFormById, type SpokesForm } from "@/lib/spokes/forms";

interface OrientationStepDefinition {
  formIds?: string[];
  note?: string;
}

export interface OrientationStepDetail {
  forms: SpokesForm[];
  note: string | null;
}

function normalizeLabel(label: string): string {
  return label
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const STEP_DEFINITIONS = new Map<string, OrientationStepDefinition>([
  [
    normalizeLabel("Program overview and facility tour"),
    {
      formIds: ["orientation-guide", "welcome-letter"],
      note: "Use the orientation checklist and welcome letter as the guide for the walkthrough.",
    },
  ],
  [
    normalizeLabel("Review Rights and Responsibilities"),
    { formIds: ["rights-responsibilities"] },
  ],
  [
    normalizeLabel("Review Code of Conduct and Dress Code"),
    { formIds: ["dress-code"] },
  ],
  [
    normalizeLabel("Review Attendance/Class Closing Policy"),
    { formIds: ["attendance-contract"] },
  ],
  [
    normalizeLabel("Review Daily Sign-in Sheet"),
    {
      formIds: ["sign-in-sheet"],
      note: "This is usually reviewed with your instructor and tracked by the class rather than uploaded by students.",
    },
  ],
  [
    normalizeLabel("Review Class Schedule/Holidays Observed"),
    {
      note: "Review the class schedule and holiday calendar provided by your instructor. There is no standard program PDF attached to this step.",
    },
  ],
  [
    normalizeLabel("Complete SPOKES Student Profile"),
    { formIds: ["student-profile"] },
  ],
  [
    normalizeLabel("Sign Personal Attendance Contract"),
    { formIds: ["attendance-contract"] },
  ],
  [
    normalizeLabel("Sign Authorization for Release of Information"),
    {
      formIds: ["auth-release", "dohs-release"],
      note: "Programs often collect both the general release and the DoHS release during intake.",
    },
  ],
  [
    normalizeLabel("Complete Media Release Form"),
    { formIds: ["media-release"] },
  ],
  [
    normalizeLabel("Sign Technology Acceptable Use Policy"),
    { formIds: ["tech-acceptable-use"] },
  ],
  [
    normalizeLabel("Complete DoHS Participant Time Sheet"),
    { formIds: ["dfa-ts-12"] },
  ],
  [
    normalizeLabel("Complete Learning Needs Screening"),
    {
      formIds: ["learning-needs"],
      note: "If your class uses a paper screener, upload the completed copy here after it is signed or reviewed.",
    },
  ],
  [
    normalizeLabel("Document disability accommodations"),
    {
      note: "Complete this with your instructor and case manager if accommodations are needed. Upload signed accommodation paperwork only if your program requires it.",
    },
  ],
  [
    normalizeLabel("Complete TABE Locator assessment"),
    {
      note: "The TABE Locator is completed in the assessment system with your instructor. No standard PDF is attached.",
    },
  ],
  [
    normalizeLabel("Complete TABE entry assessment"),
    {
      note: "The TABE entry assessment is completed in the assessment system with your instructor. No standard PDF is attached.",
    },
  ],
  [
    normalizeLabel("Complete Education and Career Plan"),
    { formIds: ["education-career-plan"] },
  ],
  [
    normalizeLabel("Complete career interest assessment"),
    {
      note: "This is usually completed in an assessment platform or instructor-led activity. No standard PDF is attached.",
    },
  ],
  [
    normalizeLabel("Private student interview"),
    {
      note: "Meet one-on-one with your instructor to review results, barriers, and next steps. No PDF is required for this conversation.",
    },
  ],
  [
    normalizeLabel("Confirm attendance schedule"),
    {
      formIds: ["attendance-contract"],
      note: "Use the attendance contract to confirm the agreed schedule and commitment.",
    },
  ],
  [
    normalizeLabel("Review Employment Portfolio Checklist"),
    { formIds: ["portfolio-checklist"] },
  ],
  [
    normalizeLabel("Review SPOKES Module Record"),
    {
      formIds: ["spokes-module-record"],
      note: "This is a tracking document that students usually review rather than upload.",
    },
  ],
  [
    normalizeLabel("Review Ready to Work Attendance Verification"),
    {
      formIds: ["rtw-attendance"],
      note: "This is a certification tracking form that is usually maintained by staff.",
    },
  ],
  [
    normalizeLabel("Set up your Sage profile"),
    {
      note: "Complete this step directly in VisionQuest with your instructor. No PDF is attached.",
    },
  ],
]);

export function getOrientationStepDetail(itemLabel: string): OrientationStepDetail {
  const definition = STEP_DEFINITIONS.get(normalizeLabel(itemLabel));
  const forms = (definition?.formIds ?? [])
    .map((formId) => getFormById(formId))
    .filter((form): form is SpokesForm => !!form);

  return {
    forms,
    note: definition?.note ?? null,
  };
}
