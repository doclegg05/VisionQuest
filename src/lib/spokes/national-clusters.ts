// =============================================================================
// National Career Clusters → SPOKES Pathway Mapping
// Maps the 16 nationally recognized career clusters to SPOKES program clusters.
// Used by the discovery extractor to connect broader career interests to
// available SPOKES certifications and platforms.
// =============================================================================

export const NATIONAL_CAREER_CLUSTERS = [
  "Agriculture, Food & Natural Resources",
  "Architecture & Construction",
  "Arts, A/V Technology & Communications",
  "Business Management & Administration",
  "Education & Training",
  "Finance",
  "Government & Public Administration",
  "Health Science",
  "Hospitality & Tourism",
  "Human Services",
  "Information Technology",
  "Law, Public Safety, Corrections & Security",
  "Manufacturing",
  "Marketing",
  "Science, Technology, Engineering & Mathematics",
  "Transportation, Distribution & Logistics",
] as const;

export type NationalCluster = (typeof NATIONAL_CAREER_CLUSTERS)[number];

export const NATIONAL_TO_SPOKES_MAP: Record<NationalCluster, string[]> = {
  "Agriculture, Food & Natural Resources": ["career-readiness"],
  "Architecture & Construction": ["career-readiness"],
  "Arts, A/V Technology & Communications": ["creative-design"],
  "Business Management & Administration": ["office-admin", "finance-bookkeeping"],
  "Education & Training": ["customer-service", "career-readiness"],
  "Finance": ["finance-bookkeeping"],
  "Government & Public Administration": ["office-admin", "career-readiness"],
  "Health Science": ["career-readiness"],
  "Hospitality & Tourism": ["customer-service"],
  "Human Services": ["customer-service", "language-esl"],
  "Information Technology": ["tech-digital"],
  "Law, Public Safety, Corrections & Security": ["career-readiness"],
  "Manufacturing": ["career-readiness"],
  "Marketing": ["creative-design", "customer-service"],
  "Science, Technology, Engineering & Mathematics": ["tech-digital"],
  "Transportation, Distribution & Logistics": ["career-readiness"],
};

export function formatNationalClustersForPrompt(): string {
  const lines = [
    "NATIONAL CAREER CLUSTERS (16 standard clusters — score only those relevant):",
  ];

  for (const cluster of NATIONAL_CAREER_CLUSTERS) {
    const spokesIds = NATIONAL_TO_SPOKES_MAP[cluster];
    lines.push(`- ${cluster} → SPOKES pathways: [${spokesIds.join(", ")}]`);
  }

  return lines.join("\n");
}
