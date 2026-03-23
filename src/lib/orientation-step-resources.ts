import { getFormById, type SpokesForm } from "@/lib/spokes/forms";

interface OrientationStepDefinition {
  aliases: string[];
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

function tokenize(label: string): string[] {
  return normalizeLabel(label)
    .split(" ")
    .filter(Boolean);
}

function includesAllWords(label: string, requiredWords: string[]): boolean {
  const normalized = normalizeLabel(label);
  return requiredWords.every((word) => normalized.includes(word));
}

const STEP_DEFINITIONS: OrientationStepDefinition[] = [
  {
    aliases: [
      "program overview and facility tour",
      "program overview",
      "facility tour",
      "welcome activity",
      "orientation overview",
    ],
    formIds: ["orientation-guide", "welcome-letter"],
    note: "Use the orientation checklist and welcome letter as the guide for the walkthrough.",
  },
  {
    aliases: [
      "review rights and responsibilities",
      "rights and responsibilities",
      "student rights and responsibilities",
    ],
    formIds: ["rights-responsibilities"],
  },
  {
    aliases: [
      "review code of conduct and dress code",
      "dress code",
      "code of conduct",
      "dress code policy",
    ],
    formIds: ["dress-code"],
  },
  {
    aliases: [
      "review attendance class closing policy",
      "attendance policy",
      "attendance and closing policy",
      "class closing policy",
      "attendance contract",
    ],
    formIds: ["attendance-contract"],
  },
  {
    aliases: [
      "review daily sign in sheet",
      "daily sign in sheet",
      "sign in sheet",
      "attendance sign in",
    ],
    formIds: ["sign-in-sheet"],
    note: "This is usually reviewed with your instructor and tracked by the class rather than uploaded by students.",
  },
  {
    aliases: [
      "review class schedule holidays observed",
      "class schedule",
      "holidays observed",
      "holiday schedule",
    ],
    note: "Review the class schedule and holiday calendar provided by your instructor. There is no standard program PDF attached to this step.",
  },
  {
    aliases: [
      "complete spokes student profile",
      "student profile",
      "complete student profile",
    ],
    formIds: ["student-profile"],
  },
  {
    aliases: [
      "sign personal attendance contract",
      "personal attendance contract",
    ],
    formIds: ["attendance-contract"],
  },
  {
    aliases: [
      "sign authorization for release of information",
      "authorization for release of information",
      "release of information",
      "sign release information",
      "release information",
    ],
    formIds: ["auth-release", "dohs-release"],
    note: "Programs often collect both the general release and the DoHS release during intake.",
  },
  {
    aliases: [
      "complete media release form",
      "media release form",
      "media release",
    ],
    formIds: ["media-release"],
  },
  {
    aliases: [
      "sign technology acceptable use policy",
      "technology acceptable use policy",
      "acceptable use policy",
      "technology use policy",
    ],
    formIds: ["tech-acceptable-use"],
  },
  {
    aliases: [
      "complete dohs participant time sheet",
      "participant time sheet",
      "time sheet",
      "timesheet",
      "dfa ts 12",
    ],
    formIds: ["dfa-ts-12"],
  },
  {
    aliases: [
      "complete learning needs screening",
      "learning needs screening",
      "learning needs screener",
      "learning needs",
    ],
    formIds: ["learning-needs"],
    note: "If your class uses a paper screener, upload the completed copy here after it is signed or reviewed.",
  },
  {
    aliases: [
      "document disability accommodations",
      "disability accommodations",
      "accommodations",
    ],
    note: "Complete this with your instructor and case manager if accommodations are needed. Upload signed accommodation paperwork only if your program requires it.",
  },
  {
    aliases: [
      "complete tabe locator assessment",
      "tabe locator",
      "locator assessment",
    ],
    note: "The TABE Locator is completed in the assessment system with your instructor. No standard PDF is attached.",
  },
  {
    aliases: [
      "complete tabe entry assessment",
      "tabe entry assessment",
      "tabe assessment",
    ],
    note: "The TABE entry assessment is completed in the assessment system with your instructor. No standard PDF is attached.",
  },
  {
    aliases: [
      "complete education and career plan",
      "education and career plan",
      "career plan",
    ],
    formIds: ["education-career-plan"],
  },
  {
    aliases: [
      "complete career interest assessment",
      "career interest assessment",
      "career assessment",
      "interest assessment",
    ],
    note: "This is usually completed in an assessment platform or instructor-led activity. No standard PDF is attached.",
  },
  {
    aliases: [
      "private student interview",
      "student interview",
      "private interview",
    ],
    note: "Meet one-on-one with your instructor to review results, barriers, and next steps. No PDF is required for this conversation.",
  },
  {
    aliases: [
      "confirm attendance schedule",
      "attendance schedule",
      "confirm schedule",
    ],
    formIds: ["attendance-contract"],
    note: "Use the attendance contract to confirm the agreed schedule and commitment.",
  },
  {
    aliases: [
      "review employment portfolio checklist",
      "employment portfolio checklist",
      "portfolio checklist",
    ],
    formIds: ["portfolio-checklist"],
  },
  {
    aliases: [
      "review spokes module record",
      "spokes module record",
      "module record",
      "rubric record",
    ],
    formIds: ["spokes-module-record"],
    note: "This is a tracking document that students usually review rather than upload.",
  },
  {
    aliases: [
      "review ready to work attendance verification",
      "ready to work attendance verification",
      "ready to work",
      "attendance verification",
    ],
    formIds: ["rtw-attendance"],
    note: "This is a certification tracking form that is usually maintained by staff.",
  },
  {
    aliases: [
      "set up your sage profile",
      "sage profile",
      "set up sage",
    ],
    note: "Complete this step directly in VisionQuest with your instructor. No PDF is attached.",
  },
];

function buildDetail(definition: OrientationStepDefinition | undefined): OrientationStepDetail {
  const forms = (definition?.formIds ?? [])
    .map((formId) => getFormById(formId))
    .filter((form): form is SpokesForm => !!form);

  return {
    forms,
    note: definition?.note ?? null,
  };
}

function findByAlias(itemLabel: string): OrientationStepDefinition | undefined {
  const normalized = normalizeLabel(itemLabel);

  return STEP_DEFINITIONS.find((definition) =>
    definition.aliases.some((alias) => normalizeLabel(alias) === normalized || normalized.includes(normalizeLabel(alias))),
  );
}

function findByKeywordHeuristics(itemLabel: string): OrientationStepDefinition | undefined {
  if (includesAllWords(itemLabel, ["attendance"]) && (includesAllWords(itemLabel, ["policy"]) || includesAllWords(itemLabel, ["contract"]) || includesAllWords(itemLabel, ["closing"]))) {
    return STEP_DEFINITIONS.find((definition) => definition.formIds?.includes("attendance-contract"));
  }

  if (includesAllWords(itemLabel, ["release", "information"])) {
    return STEP_DEFINITIONS.find((definition) => definition.formIds?.includes("dohs-release"));
  }

  if (includesAllWords(itemLabel, ["rights", "responsibil"])) {
    return STEP_DEFINITIONS.find((definition) => definition.formIds?.includes("rights-responsibilities"));
  }

  if (includesAllWords(itemLabel, ["dress", "code"]) || (includesAllWords(itemLabel, ["conduct"]) && includesAllWords(itemLabel, ["dress"]))) {
    return STEP_DEFINITIONS.find((definition) => definition.formIds?.includes("dress-code"));
  }

  if (includesAllWords(itemLabel, ["student", "profile"])) {
    return STEP_DEFINITIONS.find((definition) => definition.formIds?.includes("student-profile"));
  }

  if (includesAllWords(itemLabel, ["media", "release"])) {
    return STEP_DEFINITIONS.find((definition) => definition.formIds?.includes("media-release"));
  }

  if ((includesAllWords(itemLabel, ["technology"]) || includesAllWords(itemLabel, ["tech"])) && (includesAllWords(itemLabel, ["acceptable"]) || includesAllWords(itemLabel, ["use"]))) {
    return STEP_DEFINITIONS.find((definition) => definition.formIds?.includes("tech-acceptable-use"));
  }

  if (includesAllWords(itemLabel, ["time", "sheet"]) || includesAllWords(itemLabel, ["timesheet"]) || includesAllWords(itemLabel, ["dfa", "ts", "12"])) {
    return STEP_DEFINITIONS.find((definition) => definition.formIds?.includes("dfa-ts-12"));
  }

  if (includesAllWords(itemLabel, ["sign", "in"]) && includesAllWords(itemLabel, ["sheet"])) {
    return STEP_DEFINITIONS.find((definition) => definition.formIds?.includes("sign-in-sheet"));
  }

  if (includesAllWords(itemLabel, ["learning", "needs"])) {
    return STEP_DEFINITIONS.find((definition) => definition.formIds?.includes("learning-needs"));
  }

  if (includesAllWords(itemLabel, ["career", "plan"]) || includesAllWords(itemLabel, ["education", "career", "plan"])) {
    return STEP_DEFINITIONS.find((definition) => definition.formIds?.includes("education-career-plan"));
  }

  if (includesAllWords(itemLabel, ["portfolio", "checklist"])) {
    return STEP_DEFINITIONS.find((definition) => definition.formIds?.includes("portfolio-checklist"));
  }

  if (includesAllWords(itemLabel, ["module", "record"])) {
    return STEP_DEFINITIONS.find((definition) => definition.formIds?.includes("spokes-module-record"));
  }

  if (includesAllWords(itemLabel, ["ready", "work"]) || (includesAllWords(itemLabel, ["attendance", "verification"]) && includesAllWords(itemLabel, ["certification"]))) {
    return STEP_DEFINITIONS.find((definition) => definition.formIds?.includes("rtw-attendance"));
  }

  return undefined;
}

export function getOrientationStepDetail(itemLabel: string): OrientationStepDetail {
  const tokens = tokenize(itemLabel);
  if (tokens.length === 0) {
    return { forms: [], note: null };
  }

  const definition =
    findByAlias(itemLabel)
    ?? findByKeywordHeuristics(itemLabel);

  return buildDetail(definition);
}
