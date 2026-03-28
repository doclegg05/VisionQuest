// =============================================================================
// SPOKES Forms
// Static metadata for all SPOKES program forms and documents
// =============================================================================

export type FormCategory =
  | "onboarding"
  | "compliance"
  | "dohs"
  | "portfolio"
  | "certification-tracking";

export interface SpokesForm {
  id: string;
  title: string;
  description: string;
  category: FormCategory;
  fileName: string;
  storageKey: string | null;
  fillable: boolean;
  required: boolean;
  audience: "student" | "instructor" | "both";
  acceptsSubmission: boolean;
  requiresSignature: boolean;
  sortOrder: number;
}

export const FORM_CATEGORIES: Record<
  FormCategory,
  { label: string; icon: string; description: string }
> = {
  onboarding: {
    label: "Onboarding",
    icon: "📋",
    description: "Forms and documents for new student enrollment",
  },
  compliance: {
    label: "Compliance",
    icon: "✅",
    description: "Attendance and regulatory compliance forms",
  },
  dohs: {
    label: "DoHS / WV Works",
    icon: "🏛️",
    description: "Department of Health Services and WV Works program forms",
  },
  portfolio: {
    label: "Portfolio",
    icon: "💼",
    description: "Employment portfolio building documents",
  },
  "certification-tracking": {
    label: "Certification Tracking",
    icon: "🏆",
    description: "Certification progress and verification forms",
  },
};

export const FORMS: SpokesForm[] = [
  // ---------------------------------------------------------------------------
  // Onboarding
  // ---------------------------------------------------------------------------
  {
    id: "welcome-letter",
    title: "New Student Welcome Letter",
    description: "Welcome packet and program overview",
    category: "onboarding",
    fileName: "New Student Welcome Letter.pdf",
    storageKey: "forms/New Student Welcome Letter.pdf",
    fillable: false,
    required: false,
    audience: "student",
    acceptsSubmission: false,
    requiresSignature: false,
    sortOrder: 1,
  },
  {
    id: "orientation-guide",
    title: "SPOKES Orientation Checklist",
    description: "Official checklist used to guide student orientation and intake",
    category: "onboarding",
    fileName: "SPOKES Checklist for Student Orientation.pdf",
    storageKey: "orientation/SPOKES Checklist for Student Orientation.pdf",
    fillable: false,
    required: false,
    audience: "both",
    acceptsSubmission: false,
    requiresSignature: false,
    sortOrder: 2,
  },
  {
    id: "student-profile",
    title: "SPOKES Student Profile",
    description: "Personal information, background, and contact details",
    category: "onboarding",
    fileName: "SPOKES_Student_Profile_FY26_Fillable.pdf",
    storageKey: "orientation/SPOKES_Student_Profile_FY26_Fillable.pdf",
    fillable: true,
    required: true,
    audience: "student",
    acceptsSubmission: true,
    requiresSignature: false,
    sortOrder: 3,
  },
  {
    id: "attendance-contract",
    title: "Personal Attendance Contract",
    description: "Agreement on attendance expectations and commitments",
    category: "onboarding",
    fileName: "SPOKES_Personal_Attendance_Contract_FY26_Fillable.pdf",
    storageKey: "orientation/SPOKES_Personal_Attendance_Contract_FY26_Fillable.pdf",
    fillable: true,
    required: true,
    audience: "student",
    acceptsSubmission: true,
    requiresSignature: true,
    sortOrder: 4,
  },
  {
    id: "rights-responsibilities",
    title: "Rights and Responsibilities",
    description:
      "Student rights within the program and expected responsibilities",
    category: "onboarding",
    fileName: "SPOKES_Rights_and_Responsibilities_FY26_Fillable.pdf",
    storageKey: "orientation/SPOKES_Rights_and_Responsibilities_FY26_Fillable.pdf",
    fillable: true,
    required: true,
    audience: "student",
    acceptsSubmission: true,
    requiresSignature: true,
    sortOrder: 5,
  },
  {
    id: "dress-code",
    title: "Dress Code Policy",
    description:
      "Professional appearance standards for the classroom and workplace",
    category: "onboarding",
    fileName: "SPOKES_Dress_Code_Policy_FY26_Fillable.pdf",
    storageKey: "orientation/SPOKES_Dress_Code_Policy_FY26_Fillable.pdf",
    fillable: true,
    required: true,
    audience: "student",
    acceptsSubmission: true,
    requiresSignature: true,
    sortOrder: 6,
  },
  {
    id: "auth-release",
    title: "Authorization for Release of Information",
    description: "General release that allows approved agencies or individuals to receive information",
    category: "onboarding",
    fileName: "Authorization_for_Release_of_Information_to_External_Agencies_v1.pdf",
    storageKey:
      "teachers/guides/Hanbook Appendix/Section 4/Fillable Intake Forms/Authorization_for_Release_of_Information_to_External_Agencies_v1.pdf",
    fillable: true,
    required: true,
    audience: "student",
    acceptsSubmission: true,
    requiresSignature: true,
    sortOrder: 7,
  },
  {
    id: "dohs-release",
    title: "DoHS Release of Information",
    description: "Department of Health Services consent for data sharing",
    category: "onboarding",
    fileName: "WVAdultEd_DoHS_Release_of_Information_FY26_Fillable.pdf",
    storageKey: "orientation/WVAdultEd_DoHS_Release_of_Information_FY26_Fillable.pdf",
    fillable: true,
    required: true,
    audience: "student",
    acceptsSubmission: true,
    requiresSignature: true,
    sortOrder: 8,
  },
  {
    id: "media-release",
    title: "Media Release Form",
    description:
      "Consent for use of your photo or video in program materials",
    category: "onboarding",
    fileName: "Media_Release_Form_FY26_Fillable.pdf",
    storageKey: "orientation/Media_Release_Form_FY26_Fillable.pdf",
    fillable: true,
    required: false,
    audience: "student",
    acceptsSubmission: true,
    requiresSignature: true,
    sortOrder: 9,
  },
  {
    id: "tech-acceptable-use",
    title: "Technology Acceptable Use Policy",
    description:
      "Rules for using program computers, internet, and technology resources",
    category: "onboarding",
    fileName: "WVAdultEd_Tech_Accept_Use_Fillable.pdf",
    storageKey: "orientation/WVAdultEd_Tech_Accept_Use_Fillable.pdf",
    fillable: true,
    required: true,
    audience: "student",
    acceptsSubmission: true,
    requiresSignature: true,
    sortOrder: 10,
  },
  {
    id: "portfolio-checklist",
    title: "Employment Portfolio Checklist",
    description: "Requirements for completing your Employment Portfolio",
    category: "onboarding",
    fileName: "Employment_Portfolio_Checklist_FY26_Fillable.pdf",
    storageKey: "orientation/Employment_Portfolio_Checklist_FY26_Fillable.pdf",
    fillable: true,
    required: true,
    audience: "student",
    acceptsSubmission: true,
    requiresSignature: false,
    sortOrder: 11,
  },
  {
    id: "learning-needs",
    title: "Learning Needs Screening Instrument",
    description: "Identifies any learning accommodations you may need",
    category: "onboarding",
    fileName: "29050_Learning_Needs_Screener_Form-v1_1.pdf",
    storageKey:
      "teachers/guides/Hanbook Appendix/Section 4/29050_Learning_Needs_Screener_Form-v1_1.pdf",
    fillable: true,
    required: true,
    audience: "student",
    acceptsSubmission: true,
    requiresSignature: false,
    sortOrder: 12,
  },
  {
    id: "learning-styles",
    title: "CTE Learning Styles Assessment",
    description:
      "Identifies your preferred learning style for better instruction",
    category: "onboarding",
    fileName: "CTE Learning Needs Styles instrument.pdf",
    storageKey: null,
    fillable: false,
    required: true,
    audience: "student",
    acceptsSubmission: true,
    requiresSignature: false,
    sortOrder: 13,
  },
  {
    id: "non-discrimination",
    title: "Non-Discrimination Notice",
    description: "Federal compliance notice about equal opportunity",
    category: "onboarding",
    fileName: "WVAdultEd Sample Non-Discrimination Notice.pdf",
    storageKey:
      "teachers/guides/Hanbook Appendix/Section 4/WVAdultEd Sample Non-Discrimination Notice.pdf",
    fillable: false,
    required: true,
    audience: "student",
    acceptsSubmission: false,
    requiresSignature: false,
    sortOrder: 14,
  },
  {
    id: "education-career-plan",
    title: "Education and Career Plan",
    description: "Goal-setting form used to document your education and career plan",
    category: "onboarding",
    fileName: "Education and Career Plan Form.pdf",
    storageKey:
      "teachers/guides/Hanbook Appendix/Section 7/ECP/Education and Career Plan Form.pdf",
    fillable: false,
    required: true,
    audience: "student",
    acceptsSubmission: true,
    requiresSignature: true,
    sortOrder: 15,
  },

  // ---------------------------------------------------------------------------
  // Compliance
  // ---------------------------------------------------------------------------
  {
    id: "sign-in-sheet",
    title: "Student Sign-in Sheet",
    description: "Daily attendance tracking sheet",
    category: "compliance",
    fileName: "WVAdultEd_Sign_in_sheet_5_2023.pdf",
    storageKey:
      "teachers/guides/Hanbook Appendix/Section 4/WVAdultEd_Sign_in_sheet_5_2023.pdf",
    fillable: false,
    required: true,
    audience: "both",
    acceptsSubmission: false,
    requiresSignature: false,
    sortOrder: 1,
  },

  // ---------------------------------------------------------------------------
  // DoHS / WV Works
  // ---------------------------------------------------------------------------
  {
    id: "dfa-ts-12",
    title: "DFA-TS-12 Activity Tracking",
    description:
      "Daily activity tracking and time sheet for WV Works participants",
    category: "dohs",
    fileName: "DFA-TS-12_Rev_-2-24_Fillable.pdf",
    storageKey: "forms/DFA-TS-12_Rev_-2-24_Fillable.pdf",
    fillable: true,
    required: true,
    audience: "both",
    acceptsSubmission: true,
    requiresSignature: true,
    sortOrder: 1,
  },
  {
    id: "dfa-wvw-70",
    title: "DFA-WVW-70 Participant Form",
    description: "WV Works participant verification and documentation",
    category: "dohs",
    fileName: "DFA-WVW-70_Rev-3-5-24-Sample.pdf",
    storageKey: "forms/DFA-WVW-70_Rev-3-5-24-Sample.pdf",
    fillable: false,
    required: true,
    audience: "both",
    acceptsSubmission: false,
    requiresSignature: false,
    sortOrder: 2,
  },
  {
    id: "dfa-wvw-25",
    title: "DFA-WVW-25 Support Services",
    description: "Documentation and request for WV Works support services",
    category: "dohs",
    fileName: "DFA-WVW-25_Rev_6-24.pdf",
    storageKey: "forms/DFA-WVW-25_Rev_6-24.pdf",
    fillable: false,
    required: false,
    audience: "both",
    acceptsSubmission: true,
    requiresSignature: true,
    sortOrder: 3,
  },
  {
    id: "dfa-prc-1",
    title: "DFA-PRC-1 Program Completion",
    description: "Program completion record documenting milestones achieved",
    category: "dohs",
    fileName: "DFA-PRC-1_Rev-1-24.pdf",
    storageKey: "forms/DFA-PRC-1_Rev-1-24.pdf",
    fillable: false,
    required: false,
    audience: "both",
    acceptsSubmission: false,
    requiresSignature: false,
    sortOrder: 4,
  },
  {
    id: "dfa-ssp-1",
    title: "DFA-SSP-1 Support Services Plan",
    description: "Support services plan outlining available assistance",
    category: "dohs",
    fileName: "DFA_-_SSP-1_1-9-24.pdf",
    storageKey: "forms/DFA_-_SSP-1_1-9-24.pdf",
    fillable: false,
    required: false,
    audience: "both",
    acceptsSubmission: true,
    requiresSignature: true,
    sortOrder: 5,
  },
  {
    id: "support-services-fact-sheet",
    title: "Support Services Fact Sheet",
    description:
      "Overview of transportation, childcare, work supplies, and other support services available through WV Works",
    category: "dohs",
    fileName: "Support_Services_Fact_Sheet_Rev_6-22.pdf",
    storageKey: "forms/Support_Services_Fact_Sheet_Rev_6-22.pdf",
    fillable: false,
    required: false,
    audience: "both",
    acceptsSubmission: false,
    requiresSignature: false,
    sortOrder: 6,
  },
  {
    id: "employer-letter",
    title: "Prospective Employer Letter",
    description: "Template letter for employer outreach and job development",
    category: "dohs",
    fileName: "Prospective_Employer_Letter_ESP_EIP.docx.pdf",
    storageKey: "forms/Prospective_Employer_Letter_ESP_EIP.docx.pdf",
    fillable: false,
    required: false,
    audience: "both",
    acceptsSubmission: false,
    requiresSignature: false,
    sortOrder: 7,
  },
  {
    id: "dental-services",
    title: "Dental Services through WV Works",
    description:
      "Information about dental benefits available through WV Works in 2025",
    category: "dohs",
    fileName: "Dental_Services_2025_through_WV_Works.pdf",
    storageKey: "forms/Dental_Services_2025_through_WV_Works.pdf",
    fillable: false,
    required: false,
    audience: "both",
    acceptsSubmission: false,
    requiresSignature: false,
    sortOrder: 8,
  },

  // ---------------------------------------------------------------------------
  // Portfolio
  // ---------------------------------------------------------------------------
  {
    id: "portfolio-checklist-tracking",
    title: "Employment Portfolio Checklist",
    description:
      "Master checklist for building your employment portfolio with resume, certifications, and work samples",
    category: "portfolio",
    fileName: "Employment_Portfolio_Checklist_FY26_Fillable.pdf",
    storageKey: "orientation/Employment_Portfolio_Checklist_FY26_Fillable.pdf",
    fillable: true,
    required: true,
    audience: "student",
    acceptsSubmission: true,
    requiresSignature: false,
    sortOrder: 1,
  },

  // ---------------------------------------------------------------------------
  // Certification Tracking
  // ---------------------------------------------------------------------------
  {
    id: "rtw-attendance",
    title: "Ready to Work Attendance Verification",
    description:
      "Attendance verification form for Ready to Work certification",
    category: "certification-tracking",
    fileName: "Ready to Work Certification Attendance Verification Form.pdf",
    storageKey: "forms/Ready to Work Certification Attendance Verification Form.pdf",
    fillable: false,
    required: true,
    audience: "both",
    acceptsSubmission: false,
    requiresSignature: false,
    sortOrder: 1,
  },
  {
    id: "spokes-module-record",
    title: "SPOKES Module Record",
    description: "Tracks completion of standard program modules",
    category: "certification-tracking",
    fileName: "SPOKES Life and Employability Module Rubric Record.pdf",
    storageKey: "students/resources/SPOKES Life and Employability Module Rubric Record.pdf",
    fillable: false,
    required: true,
    audience: "student",
    acceptsSubmission: false,
    requiresSignature: false,
    sortOrder: 2,
  },
];

export const FORM_BY_ID = new Map(FORMS.map((form) => [form.id, form]));

export function getFormById(formId: string): SpokesForm | undefined {
  return FORM_BY_ID.get(formId);
}

export function canViewForm(form: SpokesForm, role: string): boolean {
  return form.audience !== "instructor" || role === "teacher" || role === "admin";
}

export function hasDownloadableFormDocument(form: SpokesForm): boolean {
  return !!form.storageKey;
}

export function buildFormDownloadUrl(
  formOrId: SpokesForm | string,
  mode: "view" | "download" = "view",
): string {
  const formId = typeof formOrId === "string" ? formOrId : formOrId.id;
  return `/api/forms/download?formId=${encodeURIComponent(formId)}&mode=${mode}`;
}
