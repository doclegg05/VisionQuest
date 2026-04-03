import { PLATFORMS } from "./platforms";
import { CERTIFICATIONS } from "./certifications";

interface GoalMatchResult {
  platformIds: string[];
  certificationIds: string[];
  suggestions: string[];
}

/**
 * Keyword groups that map to platform and certification IDs.
 * Each keyword group represents a domain/interest area.
 */
const KEYWORD_GROUPS: {
  keywords: string[];
  platforms: string[];
  certifications: string[];
  suggestion: string;
}[] = [
  {
    keywords: ["accounting", "bookkeeping", "quickbooks", "financial", "finance", "budget"],
    platforms: ["gmetrix-and-learnkey"],
    certifications: ["intuit-quickbooks", "intuit-bookkeeping", "intuit-personal-finance"],
    suggestion: "Check out Intuit QuickBooks certification — it's a great fit for your accounting goals",
  },
  {
    keywords: ["computer", "technology", "tech", "digital", "IT", "software"],
    platforms: ["gmetrix-and-learnkey", "essential-education"],
    certifications: ["ic3", "computer-essentials", "it-specialist-cybersecurity"],
    suggestion: "IC3 Digital Literacy and Computer Essentials will build your tech foundation",
  },
  {
    keywords: ["office", "word", "excel", "spreadsheet", "powerpoint", "microsoft", "typing"],
    platforms: ["gmetrix-and-learnkey"],
    certifications: ["mos-word", "mos-excel", "mos-powerpoint", "mos-outlook", "mos-access"],
    suggestion: "Microsoft Office Specialist certifications will boost your office skills",
  },
  {
    keywords: ["design", "creative", "photoshop", "graphic", "art", "illustrator", "visual"],
    platforms: ["gmetrix-and-learnkey"],
    certifications: ["adobe-aca", "intuit-design-delight"],
    suggestion: "Adobe Certified Associate covers Photoshop, Illustrator, and InDesign",
  },
  {
    keywords: ["customer service", "retail", "hospitality", "restaurant", "sales", "customer"],
    platforms: ["through-the-customers-eyes", "csmlearn"],
    certifications: ["customer-service-ttce", "customer-service-csm"],
    suggestion: "Through the Customer's Eyes certification builds professional service skills",
  },
  {
    keywords: ["english", "esl", "language", "speaking", "reading", "writing english"],
    platforms: ["burlington-english", "usa-learns"],
    certifications: ["burlington-english"],
    suggestion: "Burlington English and USA Learns will strengthen your English skills",
  },
  {
    keywords: ["ged", "diploma", "high school", "hse", "equivalency", "education", "math", "test"],
    platforms: ["edgenuity", "khan-academy", "aztec"],
    certifications: [],
    suggestion: "Edgenuity and Khan Academy offer great academic prep courses",
  },
  {
    keywords: ["career", "job", "work", "employment", "professional", "workplace", "interview"],
    platforms: ["bring-your-a-game", "csmlearn"],
    certifications: ["byag", "workkeys-ncrc", "professional-communications"],
    suggestion: "Bring Your A Game and WorkKeys NCRC build core employability skills",
  },
  {
    keywords: ["security", "cyber", "hacking", "network", "protect"],
    platforms: ["gmetrix-and-learnkey"],
    certifications: ["it-specialist-cybersecurity"],
    suggestion: "IT Specialist Cybersecurity is a great entry-level security credential",
  },
  {
    keywords: ["ai", "artificial intelligence", "chatgpt", "automation"],
    platforms: [],
    certifications: ["ai-foundations"],
    suggestion: "Generative AI Foundations certification covers AI tools for the workplace",
  },
  {
    keywords: ["tourism", "travel", "hotel", "west virginia"],
    platforms: ["wv-tourism-works"],
    certifications: [],
    suggestion: "WV Tourism Works connects you to the state's tourism industry",
  },
  {
    keywords: ["communication", "presenting", "public speaking", "email", "writing"],
    platforms: ["csmlearn"],
    certifications: ["professional-communications"],
    suggestion: "Professional Communications certification strengthens workplace communication",
  },
];

/**
 * Match a student's goals to relevant platforms and certifications.
 * Performs case-insensitive keyword matching against all keyword groups.
 */
export function matchGoalsToPlatforms(goalTexts: string[]): GoalMatchResult {
  const combined = goalTexts.join(" ").toLowerCase();
  const matchedPlatforms = new Set<string>();
  const matchedCerts = new Set<string>();
  const suggestions: string[] = [];

  for (const group of KEYWORD_GROUPS) {
    const hasMatch = group.keywords.some((kw) => combined.includes(kw.toLowerCase()));
    if (hasMatch) {
      group.platforms.forEach((p) => matchedPlatforms.add(p));
      group.certifications.forEach((c) => matchedCerts.add(c));
      if (group.suggestion) suggestions.push(group.suggestion);
    }
  }

  return {
    platformIds: Array.from(matchedPlatforms),
    certificationIds: Array.from(matchedCerts),
    suggestions: suggestions.slice(0, 3), // max 3 suggestions
  };
}

/**
 * Get a human-readable summary of matched certifications for display.
 */
export function getMatchedCertNames(certIds: string[]): string[] {
  return certIds
    .map((id) => CERTIFICATIONS.find((c) => c.id === id)?.shortName)
    .filter((name): name is string => !!name);
}

/**
 * Get matched platform names for display.
 */
export function getMatchedPlatformNames(platformIds: string[]): string[] {
  return platformIds
    .map((id) => PLATFORMS.find((p) => p.id === id)?.name)
    .filter((name): name is string => !!name);
}

export interface PathwaySuggestion {
  pathwayId: string;
  label: string;
  score: number;
  reason: string;
}

/**
 * Suggest pathways for a goal based on keyword overlap between the goal text
 * and the certifications/platforms included in each pathway.
 */
export function suggestPathwaysForGoal(
  goalText: string,
  pathways: Array<{
    id: string;
    label: string;
    certifications: string[];
    platforms: string[];
    active: boolean;
  }>,
): PathwaySuggestion[] {
  const activePathways = pathways.filter((p) => p.active);
  if (activePathways.length === 0) return [];

  const match = matchGoalsToPlatforms([goalText]);
  const matchedCerts = new Set(match.certificationIds);
  const matchedPlatforms = new Set(match.platformIds);

  const scored: PathwaySuggestion[] = [];

  for (const pathway of activePathways) {
    const certOverlap = pathway.certifications.filter((c) => matchedCerts.has(c)).length;
    const platformOverlap = pathway.platforms.filter((p) => matchedPlatforms.has(p)).length;
    const total = certOverlap + platformOverlap;

    if (total === 0) continue;

    const maxPossible = pathway.certifications.length + pathway.platforms.length;
    const score = maxPossible > 0 ? total / maxPossible : 0;

    const parts: string[] = [];
    if (certOverlap > 0) parts.push(`${certOverlap} matching cert${certOverlap > 1 ? "s" : ""}`);
    if (platformOverlap > 0) parts.push(`${platformOverlap} matching platform${platformOverlap > 1 ? "s" : ""}`);

    scored.push({
      pathwayId: pathway.id,
      label: pathway.label,
      score,
      reason: parts.join(", "),
    });
  }

  return scored.sort((a, b) => b.score - a.score).slice(0, 3);
}
