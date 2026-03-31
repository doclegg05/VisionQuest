// =============================================================================
// SPOKES Certifications
// Static metadata for all SPOKES program certifications
// =============================================================================

export type CertCategory =
  | "digital-literacy"
  | "office"
  | "creative"
  | "finance"
  | "career-readiness"
  | "soft-skills"
  | "cybersecurity"
  | "language";

export interface SpokesCertification {
  id: string;
  name: string;
  shortName: string;
  description: string;
  category: CertCategory;
  platforms: string[];
  examProvider: string | null;
  levels?: string[];
  estimatedHours: number;
  prerequisites: string[];
}

export const CERT_CATEGORIES: Record<CertCategory, { label: string; icon: string }> = {
  "digital-literacy": { label: "Digital Literacy", icon: "💻" },
  office: { label: "Office Suite", icon: "📊" },
  creative: { label: "Creative & Design", icon: "🎨" },
  finance: { label: "Finance & Accounting", icon: "💰" },
  "career-readiness": { label: "Career Readiness", icon: "🎯" },
  "soft-skills": { label: "Soft Skills", icon: "🤝" },
  cybersecurity: { label: "Cybersecurity", icon: "🔒" },
  language: { label: "Language", icon: "🌍" },
};

export const CERTIFICATIONS: SpokesCertification[] = [
  // ---------------------------------------------------------------------------
  // Digital Literacy
  // ---------------------------------------------------------------------------
  {
    id: "ic3",
    name: "IC3 Digital Literacy",
    shortName: "IC3",
    description:
      "Global standard for digital literacy certification. Three levels covering computing fundamentals, key applications, and living online. Master Certification requires all 3 levels.",
    category: "digital-literacy",
    platforms: ["gmetrix-and-learnkey"],
    examProvider: "Certiport",
    levels: [
      "Level 1: Computing Fundamentals",
      "Level 2: Key Applications",
      "Level 3: Living Online",
    ],
    estimatedHours: 20,
    prerequisites: [],
  },
  {
    id: "computer-essentials",
    name: "Computer Essentials",
    shortName: "Comp Essentials",
    description:
      "Digital literacy program teaching fundamental computer skills.",
    category: "digital-literacy",
    platforms: ["essential-education"],
    examProvider: null,
    estimatedHours: 8,
    prerequisites: [],
  },
  {
    id: "ai-foundations",
    name: "Generative AI Foundations",
    shortName: "AI Foundations",
    description:
      "Critical career skills certification in generative AI fundamentals.",
    category: "digital-literacy",
    platforms: [],
    examProvider: null,
    estimatedHours: 12,
    prerequisites: ["ic3"],
  },

  // ---------------------------------------------------------------------------
  // Office Suite
  // ---------------------------------------------------------------------------
  {
    id: "mos-word",
    name: "Microsoft Office Specialist - Word",
    shortName: "MOS Word",
    description:
      "Industry certification for Microsoft Word proficiency. Practice with GMetrix, test through Certiport.",
    category: "office",
    platforms: ["gmetrix-and-learnkey"],
    examProvider: "Certiport",
    estimatedHours: 15,
    prerequisites: ["ic3"],
  },
  {
    id: "mos-excel",
    name: "Microsoft Office Specialist - Excel",
    shortName: "MOS Excel",
    description:
      "Industry certification for Microsoft Excel proficiency. Practice with GMetrix, test through Certiport.",
    category: "office",
    platforms: ["gmetrix-and-learnkey"],
    examProvider: "Certiport",
    estimatedHours: 15,
    prerequisites: ["ic3"],
  },
  {
    id: "mos-powerpoint",
    name: "Microsoft Office Specialist - PowerPoint",
    shortName: "MOS PPT",
    description:
      "Industry certification for Microsoft PowerPoint proficiency. Practice with GMetrix, test through Certiport.",
    category: "office",
    platforms: ["gmetrix-and-learnkey"],
    examProvider: "Certiport",
    estimatedHours: 12,
    prerequisites: ["ic3"],
  },
  {
    id: "mos-outlook",
    name: "Microsoft Office Specialist - Outlook",
    shortName: "MOS Outlook",
    description:
      "Industry certification for Microsoft Outlook proficiency. Practice with GMetrix, test through Certiport.",
    category: "office",
    platforms: ["gmetrix-and-learnkey"],
    examProvider: "Certiport",
    estimatedHours: 10,
    prerequisites: ["ic3"],
  },
  {
    id: "mos-access",
    name: "Microsoft Office Specialist - Access",
    shortName: "MOS Access",
    description:
      "Industry certification for Microsoft Access proficiency. Practice with GMetrix, test through Certiport.",
    category: "office",
    platforms: ["gmetrix-and-learnkey"],
    examProvider: "Certiport",
    estimatedHours: 18,
    prerequisites: ["ic3", "mos-excel"],
  },

  // ---------------------------------------------------------------------------
  // Creative & Design
  // ---------------------------------------------------------------------------
  {
    id: "adobe-aca",
    name: "Adobe Certified Associate",
    shortName: "Adobe ACA",
    description:
      "Creative software certification covering Photoshop, Illustrator, and InDesign.",
    category: "creative",
    platforms: ["gmetrix-and-learnkey"],
    examProvider: "Certiport",
    estimatedHours: 30,
    prerequisites: ["computer-essentials"],
  },

  // ---------------------------------------------------------------------------
  // Finance & Accounting
  // ---------------------------------------------------------------------------
  {
    id: "intuit-quickbooks",
    name: "Intuit QuickBooks Certified User",
    shortName: "QuickBooks",
    description:
      "Bookkeeping and accounting software proficiency certification.",
    category: "finance",
    platforms: ["gmetrix-and-learnkey"],
    examProvider: "Certiport",
    estimatedHours: 25,
    prerequisites: ["ic3"],
  },
  {
    id: "intuit-bookkeeping",
    name: "Intuit Bookkeeping Professional",
    shortName: "Bookkeeping",
    description:
      "Professional bookkeeping certification through Intuit and Certiport.",
    category: "finance",
    platforms: ["gmetrix-and-learnkey"],
    examProvider: "Certiport",
    estimatedHours: 20,
    prerequisites: ["intuit-quickbooks"],
  },
  {
    id: "intuit-personal-finance",
    name: "Intuit Personal Finance",
    shortName: "Personal Finance",
    description:
      "Personal finance management certification through Intuit and Certiport.",
    category: "finance",
    platforms: ["gmetrix-and-learnkey"],
    examProvider: "Certiport",
    estimatedHours: 15,
    prerequisites: [],
  },
  {
    id: "intuit-design-delight",
    name: "Intuit Design for Delight Innovator",
    shortName: "Design for Delight",
    description:
      "Innovation and design thinking certification through Intuit and Certiport.",
    category: "creative",
    platforms: ["gmetrix-and-learnkey"],
    examProvider: "Certiport",
    estimatedHours: 12,
    prerequisites: [],
  },

  // ---------------------------------------------------------------------------
  // Career Readiness
  // ---------------------------------------------------------------------------
  {
    id: "workkeys-ncrc",
    name: "ACT WorkKeys NCRC",
    shortName: "WorkKeys",
    description:
      "Nationally recognized credential measuring Applied Math, Workplace Documents, and Business Writing. Score levels map to O*NET occupations.",
    category: "career-readiness",
    platforms: [],
    examProvider: "ACT",
    levels: ["Bronze", "Silver", "Gold", "Platinum"],
    estimatedHours: 20,
    prerequisites: [],
  },

  // ---------------------------------------------------------------------------
  // Cybersecurity
  // ---------------------------------------------------------------------------
  {
    id: "it-specialist-cybersecurity",
    name: "IT Specialist - Cybersecurity",
    shortName: "Cybersecurity",
    description: "Entry-level cybersecurity certification.",
    category: "cybersecurity",
    platforms: ["gmetrix-and-learnkey"],
    examProvider: "Certiport",
    estimatedHours: 30,
    prerequisites: ["ic3"],
  },

  // ---------------------------------------------------------------------------
  // Soft Skills
  // ---------------------------------------------------------------------------
  {
    id: "customer-service-ttce",
    name: "Through the Customer's Eyes",
    shortName: "TTCE",
    description:
      "Two-part customer service training covering service foundations and advanced interactions.",
    category: "soft-skills",
    platforms: ["through-the-customers-eyes"],
    examProvider: null,
    levels: ["Part 1", "Part 2"],
    estimatedHours: 10,
    prerequisites: [],
  },
  {
    id: "customer-service-csm",
    name: "CSM Customer Service Certification",
    shortName: "CSM",
    description:
      "Customer service management certification through CSM Learn platform.",
    category: "soft-skills",
    platforms: ["csmlearn"],
    examProvider: null,
    estimatedHours: 12,
    prerequisites: ["customer-service-ttce"],
  },
  {
    id: "byag",
    name: "Bring Your A Game",
    shortName: "BYAG",
    description:
      "Work ethic certification covering the 7 A's: Attitude, Attendance, Appearance, Ambition, Accountability, Appreciation, Acceptance.",
    category: "soft-skills",
    platforms: ["bring-your-a-game"],
    examProvider: null,
    estimatedHours: 8,
    prerequisites: [],
  },
  {
    id: "professional-communications",
    name: "Professional Communications",
    shortName: "Prof Comms",
    description:
      "Critical career skills certification in professional communications.",
    category: "soft-skills",
    platforms: [],
    examProvider: null,
    estimatedHours: 10,
    prerequisites: [],
  },

  // ---------------------------------------------------------------------------
  // Language
  // ---------------------------------------------------------------------------
  {
    id: "burlington-english",
    name: "Burlington English Certification",
    shortName: "Burlington English",
    description:
      "English language proficiency certification for ESL students.",
    category: "language",
    platforms: ["burlington-english"],
    examProvider: null,
    estimatedHours: 40,
    prerequisites: [],
  },
];
