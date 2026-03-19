import { prisma } from "@/lib/db";
import { goalCountsTowardPlan } from "@/lib/goals";
import type { GoalPlanEntry, GoalResourceLinkView, GoalResourceRecommendation } from "@/lib/goal-resource-links";
import { matchGoalsToPlatforms } from "@/lib/spokes/goal-matcher";
import { PLATFORMS } from "@/lib/spokes/platforms";

interface GoalPlanGoal {
  id: string;
  content: string;
  status: string;
}

function getPlatformUrl(platformId: string): string | null {
  const platform = PLATFORMS.find((item) => item.id === platformId);
  if (!platform) return null;
  return platform.loginUrl
    || platform.links.find((link) => link.audience !== "teacher")?.url
    || platform.links[0]?.url
    || null;
}

export async function buildGoalPlanEntries({
  goals,
  links,
}: {
  goals: GoalPlanGoal[];
  links: GoalResourceLinkView[];
}): Promise<GoalPlanEntry[]> {
  const matchByGoalId = new Map<string, ReturnType<typeof matchGoalsToPlatforms>>();
  const matchedPlatformIds = new Set<string>();
  const matchedCertificationIds = new Set<string>();

  for (const goal of goals) {
    if (!goalCountsTowardPlan(goal.status)) {
      continue;
    }

    const match = matchGoalsToPlatforms([goal.content]);
    matchByGoalId.set(goal.id, match);
    for (const platformId of match.platformIds) matchedPlatformIds.add(platformId);
    for (const certificationId of match.certificationIds) matchedCertificationIds.add(certificationId);
  }

  const documents = matchedPlatformIds.size > 0 || matchedCertificationIds.size > 0
    ? await prisma.programDocument.findMany({
        where: {
          isActive: true,
          audience: { in: ["STUDENT", "BOTH"] },
          OR: [
            ...(matchedPlatformIds.size > 0 ? [{ platformId: { in: [...matchedPlatformIds] } }] : []),
            ...(matchedCertificationIds.size > 0 ? [{ certificationId: { in: [...matchedCertificationIds] } }] : []),
          ],
        },
        orderBy: [{ sortOrder: "asc" }, { title: "asc" }],
        select: {
          id: true,
          title: true,
          description: true,
          platformId: true,
          certificationId: true,
        },
      })
    : [];

  return goals.map((goal) => {
    const match = matchByGoalId.get(goal.id);
    const goalLinks = links
      .filter((link) => link.goalId === goal.id)
      .sort((left, right) => {
        const leftTime = new Date(left.createdAt).getTime();
        const rightTime = new Date(right.createdAt).getTime();
        return leftTime - rightTime;
      });

    const existingKeys = new Set(goalLinks.map((link) => `${link.resourceType}:${link.resourceId}`));
    const recommendations = new Map<string, GoalResourceRecommendation>();

    if (match) {
      for (const platformId of match.platformIds) {
        const platform = PLATFORMS.find((item) => item.id === platformId);
        if (!platform) continue;

        const key = `platform:${platform.id}`;
        if (!existingKeys.has(key) && !recommendations.has(key)) {
          recommendations.set(key, {
            resourceType: "platform",
            resourceId: platform.id,
            title: platform.name,
            description: platform.description,
            url: getPlatformUrl(platform.id),
            reason: "Matched from goal keywords",
          });
        }
      }

      for (const document of documents) {
        const matchesPlatform = !!document.platformId && match.platformIds.includes(document.platformId);
        const matchesCertification = !!document.certificationId && match.certificationIds.includes(document.certificationId);
        if (!matchesPlatform && !matchesCertification) continue;

        const key = `document:${document.id}`;
        if (!existingKeys.has(key) && !recommendations.has(key)) {
          recommendations.set(key, {
            resourceType: "document",
            resourceId: document.id,
            title: document.title,
            description: document.description,
            url: `/api/documents/download?id=${document.id}&mode=view`,
            reason: matchesPlatform ? "Guide tied to a matched platform" : "Guide tied to a matched certification",
          });
        }
      }
    }

    return {
      goalId: goal.id,
      suggestions: match?.suggestions || [],
      recommendations: [...recommendations.values()].slice(0, 6),
      links: goalLinks,
    };
  });
}
