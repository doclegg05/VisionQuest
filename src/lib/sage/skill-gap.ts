// =============================================================================
// Skill Gap Analysis
// Compares a student's demonstrated skills and active certifications against
// the required skills for their target SPOKES career cluster.
// No AI calls — pure data comparison.
// =============================================================================

import { prisma } from "@/lib/db";
import { CAREER_CLUSTERS, getClusterById, type RequiredSkill } from "@/lib/spokes/career-clusters";
import { CERTIFICATIONS } from "@/lib/spokes/certifications";
import { PLATFORMS } from "@/lib/spokes/platforms";

export interface SkillGapItem {
  name: string;
  category: string;
  importance: "essential" | "important" | "helpful";
  status: "have" | "building" | "need";
  evidence?: string;         // for "have" — quote from discovery
  buildingVia?: string;      // for "building" — cert/platform name
  recommendedAction?: string; // for "need" — what to do next
}

export interface SkillGapAnalysis {
  targetCluster: string;
  targetClusterName: string;
  skills: SkillGapItem[];
  haveCount: number;
  buildingCount: number;
  needCount: number;
  readinessPercent: number; // (have + building) / total * 100
}

// ---------------------------------------------------------------------------
// Cert → skills mapping
// Maps SPOKES certification IDs to the required skill names they teach.
// Skill names must match exactly (case-insensitive) or share keywords with
// the RequiredSkill names defined in career-clusters.ts.
// ---------------------------------------------------------------------------

const CERT_SKILL_MAP: Record<string, string[]> = {
  "mos-word": ["Microsoft Word proficiency", "Professional email writing"],
  "mos-excel": ["Microsoft Excel proficiency", "Spreadsheet analysis", "Data entry accuracy"],
  "mos-powerpoint": ["Microsoft PowerPoint"],
  "mos-outlook": ["Microsoft Outlook", "Professional email writing", "Calendar management"],
  "mos-access": ["Filing and records management", "Data entry accuracy"],
  "intuit-quickbooks": ["QuickBooks proficiency"],
  "intuit-bookkeeping": ["Basic accounting principles", "Data entry accuracy"],
  "intuit-personal-finance": ["Personal finance management"],
  "intuit-design-delight": ["Design for Delight innovation mindset", "Creative thinking and ideation"],
  "ic3": ["Computer fundamentals", "Internet and digital literacy"],
  "computer-essentials": ["Computer fundamentals", "Internet and digital literacy"],
  "ai-foundations": ["AI tools and concepts"],
  "it-specialist-cybersecurity": ["Cybersecurity awareness"],
  "adobe-aca": ["Adobe Photoshop", "Adobe Illustrator", "Visual design principles", "Typography and layout"],
  "workkeys-ncrc": ["Workplace math", "Reading workplace documents"],
  "professional-communications": ["Professional communication", "Technical communication"],
  "customer-service-ttce": ["Active listening", "Conflict resolution", "Positive attitude and appearance"],
  "customer-service-csm": ["Active listening", "Professional communication", "Conflict resolution"],
  "byag": ["Work ethic and reliability", "Work ethic and attendance", "Positive attitude and appearance"],
  "burlington-english": [
    "English reading comprehension",
    "English writing",
    "English speaking and listening",
    "Workplace vocabulary",
  ],
};

// Platform → skills mapping
// Maps platform IDs to skills students develop while enrolled on the platform.
const PLATFORM_SKILL_MAP: Record<string, string[]> = {
  "gmetrix-and-learnkey": ["Computer fundamentals", "Internet and digital literacy"],
  "essential-education": ["Computer fundamentals", "Internet and digital literacy"],
  "csmlearn": ["Active listening", "Professional communication"],
  "bring-your-a-game": ["Work ethic and reliability", "Work ethic and attendance"],
  "through-the-customers-eyes": ["Active listening", "Conflict resolution"],
  "wv-tourism-works": ["Hospitality and tourism knowledge"],
  "burlington-english": ["English reading comprehension", "English writing", "English speaking and listening"],
  "usa-learns": ["English reading comprehension", "English speaking and listening"],
};

// ---------------------------------------------------------------------------
// Recommended actions for skills with "need" status
// ---------------------------------------------------------------------------

function buildRecommendedAction(skillName: string, clusterId: string): string {
  const cluster = getClusterById(clusterId);
  if (!cluster) return "Talk to Sage about how to build this skill.";

  // Find which cert in this cluster teaches this skill
  for (const certId of cluster.certificationIds) {
    const teaches = CERT_SKILL_MAP[certId] ?? [];
    if (teaches.some((s) => normalizeSkill(s) === normalizeSkill(skillName))) {
      const cert = CERTIFICATIONS.find((c) => c.id === certId);
      if (cert) {
        const platform = cert.platforms[0]
          ? PLATFORMS.find((p) => p.id === cert.platforms[0])
          : null;
        if (platform) {
          return `Start the ${cert.shortName} on ${platform.name}.`;
        }
        return `Pursue the ${cert.shortName} certification.`;
      }
    }
  }

  return "Talk to Sage about how to build this skill.";
}

// ---------------------------------------------------------------------------
// Skill matching utilities
// ---------------------------------------------------------------------------

function normalizeSkill(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
}

/**
 * Returns true if the transferable skill name/category overlaps sufficiently
 * with the required skill to count as "have".
 */
function transferableSkillMatches(
  transferableName: string,
  transferableCategory: string,
  required: RequiredSkill,
): boolean {
  const tNorm = normalizeSkill(transferableName);
  const rNorm = normalizeSkill(required.name);

  // Exact normalized name match
  if (tNorm === rNorm) return true;

  // Substring match in either direction
  if (tNorm.includes(rNorm) || rNorm.includes(tNorm)) return true;

  // Category match plus keyword overlap
  if (transferableCategory === required.category) {
    const tWords = new Set(tNorm.split(" ").filter((w) => w.length > 3));
    const rWords = rNorm.split(" ").filter((w) => w.length > 3);
    if (rWords.some((w) => tWords.has(w))) return true;
  }

  return false;
}

/**
 * Returns true if the cert teaches this required skill.
 */
function certTeachesSkill(certId: string, required: RequiredSkill): boolean {
  const teaches = CERT_SKILL_MAP[certId] ?? [];
  return teaches.some(
    (s) =>
      normalizeSkill(s) === normalizeSkill(required.name) ||
      normalizeSkill(s).includes(normalizeSkill(required.name)) ||
      normalizeSkill(required.name).includes(normalizeSkill(s)),
  );
}

// ---------------------------------------------------------------------------
// Main analysis function
// ---------------------------------------------------------------------------

export async function analyzeSkillGaps(studentId: string): Promise<SkillGapAnalysis | null> {
  // Fetch all needed data in a single query
  const [discovery, activeCerts] = await Promise.all([
    prisma.careerDiscovery.findUnique({
      where: { studentId },
      select: {
        status: true,
        topClusters: true,
        transferableSkills: true,
      },
    }),
    prisma.certification.findMany({
      where: {
        studentId,
        status: { in: ["in_progress", "completed"] },
      },
      select: {
        certType: true,
        status: true,
      },
    }),
  ]);

  if (!discovery || discovery.status !== "complete" || discovery.topClusters.length === 0) {
    return null;
  }

  const targetClusterId = discovery.topClusters[0];
  const cluster = CAREER_CLUSTERS.find((c) => c.id === targetClusterId);
  if (!cluster) return null;

  // Parse transferable skills
  type RawTransferableSkill = { skill: string; category: string; evidence?: string };
  let transferableSkills: RawTransferableSkill[] = [];
  if (discovery.transferableSkills) {
    try {
      const parsed = JSON.parse(discovery.transferableSkills) as unknown;
      if (Array.isArray(parsed)) {
        transferableSkills = parsed as RawTransferableSkill[];
      }
    } catch {
      // malformed JSON — treat as empty
    }
  }

  // Build a set of active cert IDs (certType values map to SPOKES cert IDs)
  const activeCertIds = new Set(activeCerts.map((c) => c.certType));

  // Classify each required skill
  const skills: SkillGapItem[] = cluster.requiredSkills.map((required) => {
    // --- Check "have" first: transferable skill match ---
    for (const ts of transferableSkills) {
      if (transferableSkillMatches(ts.skill, ts.category, required)) {
        return {
          name: required.name,
          category: required.category,
          importance: required.importance,
          status: "have" as const,
          evidence: ts.evidence ?? undefined,
        };
      }
    }

    // --- Check "building": in-progress or completed cert that teaches this skill ---
    for (const certId of activeCertIds) {
      if (certTeachesSkill(certId, required)) {
        const certMeta = CERTIFICATIONS.find((c) => c.id === certId);
        const certName = certMeta?.shortName ?? certId;
        return {
          name: required.name,
          category: required.category,
          importance: required.importance,
          status: "building" as const,
          buildingVia: certName,
        };
      }
    }

    // --- Check "building" via cluster platforms student is active on ---
    for (const platformId of cluster.platformIds) {
      const teaches = PLATFORM_SKILL_MAP[platformId] ?? [];
      if (teaches.some((s) => normalizeSkill(s) === normalizeSkill(required.name))) {
        const platform = PLATFORMS.find((p) => p.id === platformId);
        if (platform) {
          return {
            name: required.name,
            category: required.category,
            importance: required.importance,
            status: "building" as const,
            buildingVia: platform.name,
          };
        }
      }
    }

    // --- Default: need ---
    return {
      name: required.name,
      category: required.category,
      importance: required.importance,
      status: "need" as const,
      recommendedAction: buildRecommendedAction(required.name, targetClusterId),
    };
  });

  const haveCount = skills.filter((s) => s.status === "have").length;
  const buildingCount = skills.filter((s) => s.status === "building").length;
  const needCount = skills.filter((s) => s.status === "need").length;
  const total = skills.length;
  const readinessPercent = total > 0 ? Math.round(((haveCount + buildingCount) / total) * 100) : 0;

  return {
    targetCluster: targetClusterId,
    targetClusterName: cluster.label,
    skills,
    haveCount,
    buildingCount,
    needCount,
    readinessPercent,
  };
}
