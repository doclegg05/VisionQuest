// =============================================================================
// SPOKES Learning Platforms
// Static metadata for all 11 SPOKES program learning platforms
// =============================================================================

export type PlatformCategory =
  | "certification-prep"
  | "academic-hse"
  | "esl-language"
  | "career-skills"
  | "work-ethic"
  | "career-readiness";

export interface SpokesPlatform {
  id: string;
  name: string;
  description: string;
  category: PlatformCategory;
  icon: string;
  loginUrl: string | null;
  certifications: string[];
  links: { label: string; url: string; audience: "student" | "teacher" | "both" }[];
  tags: string[];
}

export const PLATFORM_CATEGORIES: Record<
  PlatformCategory,
  { label: string; icon: string; description: string }
> = {
  "certification-prep": {
    label: "Certification Prep",
    icon: "📜",
    description: "Practice tests and training for industry certifications",
  },
  "academic-hse": {
    label: "Academic & HSE",
    icon: "📐",
    description: "GED preparation, math, and academic courses",
  },
  "esl-language": {
    label: "ESL & Language",
    icon: "🌍",
    description: "English language learning for ESL students",
  },
  "career-skills": {
    label: "Career Skills",
    icon: "💼",
    description: "Customer service, soft skills, and career training",
  },
  "work-ethic": {
    label: "Work Ethic",
    icon: "💪",
    description: "Employability and workplace readiness curriculum",
  },
  "career-readiness": {
    label: "Career Readiness",
    icon: "🎯",
    description: "Job search, test prep, and career exploration",
  },
};

export const PLATFORMS: SpokesPlatform[] = [
  // ---------------------------------------------------------------------------
  // 1. GMetrix & LearnKey
  // ---------------------------------------------------------------------------
  {
    id: "gmetrix-and-learnkey",
    name: "GMetrix & LearnKey",
    description:
      "Practice tests and video training for Microsoft Office, IC3, QuickBooks, and other industry certifications.",
    category: "certification-prep",
    icon: "📜",
    loginUrl: "https://www.gmetrix.com",
    certifications: [
      "ic3",
      "mos-word",
      "mos-excel",
      "mos-powerpoint",
      "mos-outlook",
      "mos-access",
      "adobe-aca",
      "intuit-quickbooks",
      "intuit-bookkeeping",
      "intuit-personal-finance",
      "intuit-design-delight",
      "it-specialist-cybersecurity",
    ],
    links: [
      {
        label: "Register at Certiport",
        url: "https://certiport.pearsonvue.com",
        audience: "both",
      },
      {
        label: "GMetrix Legacy Login (.net)",
        url: "https://www.gmetrix.net",
        audience: "both",
      },
      {
        label: "Download Compass",
        url: "https://certiport.pearsonvue.com/Educator-resources/Compass",
        audience: "teacher",
      },
      {
        label: "GMetrix Quick Start Guide",
        url: "https://www.gmetrix.net/Public/Content/Help/GMetrix_Quick_Start.pdf",
        audience: "teacher",
      },
      {
        label: "IC3 Admin Portal",
        url: "https://certiport.pearsonvue.com/Educator-resources/Exam-administration",
        audience: "teacher",
      },
      {
        label: "MOS Voucher Request Form",
        url: "https://certiport.pearsonvue.com/Educator-resources/Vouchers",
        audience: "teacher",
      },
      {
        label: "Print Certifications",
        url: "https://certiport.pearsonvue.com/Certifications/Print",
        audience: "teacher",
      },
      {
        label: "MOS Exam Objectives — Word",
        url: "https://certiport.pearsonvue.com/Certifications/Microsoft/MOS/Certify/Word",
        audience: "both",
      },
      {
        label: "MOS Exam Objectives — Excel",
        url: "https://certiport.pearsonvue.com/Certifications/Microsoft/MOS/Certify/Excel",
        audience: "both",
      },
      {
        label: "MOS Exam Objectives — PowerPoint",
        url: "https://certiport.pearsonvue.com/Certifications/Microsoft/MOS/Certify/PowerPoint",
        audience: "both",
      },
      {
        label: "MOS Exam Objectives — Outlook",
        url: "https://certiport.pearsonvue.com/Certifications/Microsoft/MOS/Certify/Outlook",
        audience: "both",
      },
      {
        label: "MOS Exam Objectives — Access",
        url: "https://certiport.pearsonvue.com/Certifications/Microsoft/MOS/Certify/Access",
        audience: "both",
      },
      {
        label: "IC3 Certification Info",
        url: "https://certiport.pearsonvue.com/Certifications/IC3/Overview",
        audience: "both",
      },
      {
        label: "IC3 Technical Requirements",
        url: "https://certiport.pearsonvue.com/Certifications/IC3/Technical-Requirements",
        audience: "both",
      },
      {
        label: "Intuit QuickBooks Certification Info",
        url: "https://certiport.pearsonvue.com/Certifications/Intuit/QuickBooks/Overview",
        audience: "both",
      },
      {
        label: "QuickBooks Study Guide",
        url: "https://certiport.pearsonvue.com/Certifications/Intuit/QuickBooks/Prepare",
        audience: "both",
      },
      {
        label: "Free QuickBooks for Educators",
        url: "https://quickbooks.intuit.com/education/",
        audience: "teacher",
      },
      {
        label: "Intuit Education Portal",
        url: "https://www.intuit.com/company/education/",
        audience: "teacher",
      },
      {
        label: "Microsoft Digital Literacy",
        url: "https://www.microsoft.com/en-us/digital-literacy",
        audience: "both",
      },
      {
        label: "GMetrix Proxy Hours Form",
        url: "https://www.gmetrix.net/Public/Content/Help/ProxyHoursForm.pdf",
        audience: "teacher",
      },
    ],
    tags: ["certification", "practice-tests", "microsoft-office", "ic3", "quickbooks"],
  },

  // ---------------------------------------------------------------------------
  // 2. Edgenuity
  // ---------------------------------------------------------------------------
  {
    id: "edgenuity",
    name: "Edgenuity",
    description:
      "Online courses for academic subjects, credit recovery, and HSE preparation with virtual instruction.",
    category: "academic-hse",
    icon: "📐",
    loginUrl: "https://auth.edgenuity.com/Login/Login/Student",
    certifications: [],
    links: [
      {
        label: "Educator Login",
        url: "https://auth.edgenuity.com/Login/Login/Educator",
        audience: "teacher",
      },
      {
        label: "Student-Led Conferences Guide",
        url: "https://www.edgenuity.com/resources/student-led-conferences/",
        audience: "teacher",
      },
      {
        label: "IT Support",
        url: "https://www.edgenuity.com/support/",
        audience: "both",
      },
    ],
    tags: ["academic", "hse", "credit-recovery", "online-courses"],
  },

  // ---------------------------------------------------------------------------
  // 3. Khan Academy
  // ---------------------------------------------------------------------------
  {
    id: "khan-academy",
    name: "Khan Academy",
    description:
      "Free online courses in math, science, and test prep with personalized learning dashboards.",
    category: "academic-hse",
    icon: "📐",
    loginUrl: "https://www.khanacademy.org",
    certifications: [],
    links: [
      {
        label: "Teacher Reports Guide",
        url: "https://www.khanacademy.org/teacher/reports",
        audience: "teacher",
      },
    ],
    tags: ["math", "science", "free", "self-paced"],
  },

  // ---------------------------------------------------------------------------
  // 4. Aztec
  // ---------------------------------------------------------------------------
  {
    id: "aztec",
    name: "Aztec",
    description:
      "Software-based GED and HSE preparation program with structured lessons and practice tests.",
    category: "academic-hse",
    icon: "📐",
    loginUrl: null,
    certifications: [],
    links: [],
    tags: ["ged", "hse", "software-based", "test-prep"],
  },

  // ---------------------------------------------------------------------------
  // 5. Essential Education
  // ---------------------------------------------------------------------------
  {
    id: "essential-education",
    name: "Essential Education",
    description:
      "Online learning platform for GED prep, digital literacy, and computer essentials skills.",
    category: "academic-hse",
    icon: "📐",
    loginUrl: "https://www.essentialed.com/start/wvde",
    certifications: ["computer-essentials"],
    links: [
      {
        label: "Webinar Schedule",
        url: "https://www.essentialed.com/webinars",
        audience: "teacher",
      },
      {
        label: "Download Firefox",
        url: "https://www.mozilla.org/en-US/firefox/new/",
        audience: "both",
      },
    ],
    tags: ["ged", "digital-literacy", "computer-essentials"],
  },

  // ---------------------------------------------------------------------------
  // 6. Burlington English
  // ---------------------------------------------------------------------------
  {
    id: "burlington-english",
    name: "Burlington English",
    description:
      "Comprehensive ESL platform with speech recognition, interactive lessons, and English proficiency certification.",
    category: "esl-language",
    icon: "🌍",
    loginUrl: "https://www.burlingtonenglish.com",
    certifications: ["burlington-english"],
    links: [],
    tags: ["esl", "english", "speech-recognition", "language-learning"],
  },

  // ---------------------------------------------------------------------------
  // 7. USA Learns
  // ---------------------------------------------------------------------------
  {
    id: "usa-learns",
    name: "USA Learns",
    description:
      "Free online courses for English language learners covering reading, writing, speaking, and citizenship.",
    category: "esl-language",
    icon: "🌍",
    loginUrl: "https://www.usalearns.org",
    certifications: [],
    links: [
      {
        label: "Courses List",
        url: "https://www.usalearns.org/courses",
        audience: "student",
      },
    ],
    tags: ["esl", "free", "citizenship", "english"],
  },

  // ---------------------------------------------------------------------------
  // 8. CSM Learn
  // ---------------------------------------------------------------------------
  {
    id: "csmlearn",
    name: "CSM Learn",
    description:
      "Customer service training platform with interactive modules and certification preparation.",
    category: "career-skills",
    icon: "💼",
    loginUrl: "https://csmlearn.com",
    certifications: ["customer-service-csm"],
    links: [
      {
        label: "CSM Webinar",
        url: "https://csmlearn.com/webinar",
        audience: "both",
      },
      {
        label: "Account Request Form",
        url: "https://csmlearn.com/account-request",
        audience: "teacher",
      },
    ],
    tags: ["customer-service", "certification", "interactive"],
  },

  // ---------------------------------------------------------------------------
  // 10. Through the Customer's Eyes
  // ---------------------------------------------------------------------------
  {
    id: "through-the-customers-eyes",
    name: "Through the Customer's Eyes",
    description:
      "Two-part customer service training covering service foundations and advanced customer interactions.",
    category: "career-skills",
    icon: "💼",
    loginUrl: "https://learn.skillpath.com",
    certifications: ["customer-service-ttce"],
    links: [
      {
        label: "Account Request Form",
        url: "https://learn.skillpath.com/account-request",
        audience: "teacher",
      },
    ],
    tags: ["customer-service", "soft-skills", "two-part"],
  },

  // ---------------------------------------------------------------------------
  // 11. Bring Your A Game
  // ---------------------------------------------------------------------------
  {
    id: "bring-your-a-game",
    name: "Bring Your A Game",
    description:
      "Classroom-based work ethic curriculum covering the 7 A's: Attitude, Attendance, Appearance, Ambition, Accountability, Appreciation, and Acceptance.",
    category: "work-ethic",
    icon: "💪",
    loginUrl: null,
    certifications: ["byag"],
    links: [],
    tags: ["work-ethic", "7-as", "classroom", "employability"],
  },

  // ---------------------------------------------------------------------------
  // 12. WV Tourism Works
  // ---------------------------------------------------------------------------
  {
    id: "wv-tourism-works",
    name: "WV Tourism Works",
    description:
      "West Virginia tourism and hospitality career skills training.",
    category: "career-skills",
    icon: "💼",
    loginUrl: "https://wvtourism.com/tourismworks/free-trainings/",
    certifications: [],
    links: [],
    tags: ["tourism", "hospitality", "west-virginia"],
  },
];
