// =============================================================================
// SPOKES Career Pathway Clusters
// Maps program certifications and platforms to actionable career directions.
// Used by Sage's discovery stage to help students identify a career focus.
// =============================================================================

import { CERTIFICATIONS } from "./certifications";
import { PLATFORMS } from "./platforms";

export interface CareerCluster {
  id: string;
  label: string;
  description: string;
  certificationIds: string[];
  platformIds: string[];
  sampleJobs: string[];
  signalKeywords: string[];
}

export const CAREER_CLUSTERS: CareerCluster[] = [
  {
    id: "office-admin",
    label: "Office & Administrative Support",
    description:
      "Data entry, office management, reception, clerical work, and administrative support roles.",
    certificationIds: [
      "mos-word",
      "mos-excel",
      "mos-powerpoint",
      "mos-outlook",
      "mos-access",
    ],
    platformIds: ["gmetrix-and-learnkey"],
    sampleJobs: [
      "Administrative Assistant",
      "Receptionist",
      "Data Entry Clerk",
      "Office Manager",
      "Executive Assistant",
    ],
    signalKeywords: [
      "office",
      "typing",
      "organized",
      "paperwork",
      "filing",
      "scheduling",
      "reception",
      "data entry",
      "admin",
      "front desk",
      "email",
      "detail-oriented",
      "microsoft",
      "word",
      "excel",
      "spreadsheet",
    ],
  },
  {
    id: "finance-bookkeeping",
    label: "Finance & Bookkeeping",
    description:
      "Accounting support, bookkeeping, payroll, billing, and personal finance management.",
    certificationIds: [
      "intuit-quickbooks",
      "intuit-bookkeeping",
      "intuit-personal-finance",
    ],
    platformIds: ["gmetrix-and-learnkey"],
    sampleJobs: [
      "Bookkeeper",
      "Accounts Payable Clerk",
      "Billing Specialist",
      "Payroll Clerk",
      "Bank Teller",
    ],
    signalKeywords: [
      "numbers",
      "math",
      "money",
      "accounting",
      "bookkeeping",
      "budget",
      "finance",
      "billing",
      "payroll",
      "quickbooks",
      "banking",
      "taxes",
      "good with numbers",
    ],
  },
  {
    id: "tech-digital",
    label: "Technology & Digital Skills",
    description:
      "IT support, digital literacy, cybersecurity fundamentals, and technology-related roles.",
    certificationIds: [
      "ic3",
      "computer-essentials",
      "ai-foundations",
      "it-specialist-cybersecurity",
    ],
    platformIds: ["gmetrix-and-learnkey", "essential-education"],
    sampleJobs: [
      "Help Desk Technician",
      "IT Support Specialist",
      "Computer Lab Assistant",
      "Data Entry Technician",
      "Technology Coordinator",
    ],
    signalKeywords: [
      "computer",
      "technology",
      "tech",
      "digital",
      "software",
      "IT",
      "internet",
      "cyber",
      "security",
      "hacking",
      "network",
      "troubleshoot",
      "fix computers",
      "AI",
      "coding",
    ],
  },
  {
    id: "creative-design",
    label: "Creative & Design",
    description:
      "Graphic design, visual media, marketing materials, and creative production.",
    certificationIds: ["adobe-aca", "intuit-design-delight"],
    platformIds: ["gmetrix-and-learnkey"],
    sampleJobs: [
      "Graphic Designer",
      "Marketing Assistant",
      "Print Production Worker",
      "Social Media Content Creator",
      "Sign Maker",
    ],
    signalKeywords: [
      "design",
      "creative",
      "art",
      "drawing",
      "photoshop",
      "graphic",
      "visual",
      "illustrator",
      "marketing",
      "photography",
      "making things look good",
      "crafty",
      "artistic",
    ],
  },
  {
    id: "customer-service",
    label: "Customer Service & Hospitality",
    description:
      "Retail, hospitality, food service, tourism, and customer-facing roles.",
    certificationIds: ["customer-service-ttce", "customer-service-csm", "byag"],
    platformIds: [
      "through-the-customers-eyes",
      "csmlearn",
      "bring-your-a-game",
      "wv-tourism-works",
    ],
    sampleJobs: [
      "Customer Service Representative",
      "Retail Sales Associate",
      "Hotel Front Desk Agent",
      "Restaurant Server",
      "Call Center Agent",
    ],
    signalKeywords: [
      "people",
      "helping",
      "customer",
      "retail",
      "restaurant",
      "hotel",
      "hospitality",
      "sales",
      "talking to people",
      "friendly",
      "tourism",
      "food service",
      "like helping people",
      "outgoing",
      "social",
    ],
  },
  {
    id: "career-readiness",
    label: "General Workforce Readiness",
    description:
      "Broad employability skills, workplace math and documents, professional communication, and job search preparation.",
    certificationIds: [
      "workkeys-ncrc",
      "professional-communications",
      "byag",
    ],
    platformIds: [
      "learning-express-library",
      "csmlearn",
      "bring-your-a-game",
    ],
    sampleJobs: [
      "Entry-level positions across industries",
      "Warehouse Worker",
      "Production Associate",
      "Maintenance Worker",
      "General Laborer",
    ],
    signalKeywords: [
      "job",
      "work",
      "employment",
      "career",
      "interview",
      "resume",
      "not sure",
      "anything",
      "whatever pays",
      "just need a job",
      "get hired",
      "professional",
      "workplace",
    ],
  },
  {
    id: "language-esl",
    label: "English Language & Communication",
    description:
      "English language learning for non-native speakers to build workplace communication skills.",
    certificationIds: ["burlington-english"],
    platformIds: ["burlington-english", "usa-learns", "crossroads-cafe"],
    sampleJobs: [
      "Bilingual Customer Service Representative",
      "Interpreter Assistant",
      "Community Liaison",
      "ESL Tutor",
    ],
    signalKeywords: [
      "english",
      "esl",
      "language",
      "spanish",
      "speak",
      "reading",
      "writing",
      "learn english",
      "not my first language",
      "bilingual",
      "translate",
    ],
  },
];

export function getClusterById(id: string): CareerCluster | undefined {
  return CAREER_CLUSTERS.find((c) => c.id === id);
}

export function getClusterCertNames(cluster: CareerCluster): string[] {
  return cluster.certificationIds
    .map((id) => CERTIFICATIONS.find((c) => c.id === id)?.shortName)
    .filter((n): n is string => !!n);
}

export function getClusterPlatformNames(cluster: CareerCluster): string[] {
  return cluster.platformIds
    .map((id) => PLATFORMS.find((p) => p.id === id)?.name)
    .filter((n): n is string => !!n);
}

/**
 * Format all clusters into a text block for injection into Sage's system prompt.
 */
export function formatClustersForPrompt(): string {
  const lines = ["SPOKES CAREER PATHWAYS (use these when suggesting directions):\n"];

  for (const c of CAREER_CLUSTERS) {
    const certs = getClusterCertNames(c);
    const platforms = getClusterPlatformNames(c);
    lines.push(`${c.label} [${c.id}]`);
    lines.push(`  ${c.description}`);
    lines.push(`  Certifications: ${certs.length > 0 ? certs.join(", ") : "None"}`);
    lines.push(`  Platforms: ${platforms.length > 0 ? platforms.join(", ") : "None"}`);
    lines.push(`  Example jobs: ${c.sampleJobs.join(", ")}`);
    lines.push("");
  }

  return lines.join("\n");
}
