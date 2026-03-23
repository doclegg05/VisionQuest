import { prisma } from "@/lib/db";
import { goalCountsTowardPlan } from "@/lib/goals";
import type {
  GoalPlanEntry,
  GoalResourceLinkView,
  GoalResourceRecommendation,
} from "@/lib/goal-resource-links";
import { CERTIFICATIONS } from "@/lib/spokes/certifications";
import { buildFormDownloadUrl, FORMS } from "@/lib/spokes/forms";
import { matchGoalsToPlatforms } from "@/lib/spokes/goal-matcher";
import { PLATFORMS } from "@/lib/spokes/platforms";

interface GoalPlanGoal {
  id: string;
  content: string;
  status: string;
}

interface OrientationPlanItem {
  id: string;
  label: string;
  description: string | null;
  required: boolean;
  sortOrder: number;
}

interface PortfolioTaskDefinition {
  id: string;
  title: string;
  description: string;
  url: string;
  keywords: string[];
}

interface CareerStepDefinition {
  id: string;
  title: string;
  description: string;
  url: string;
  keywords: string[];
}

interface OpportunityRecommendation {
  id: string;
  title: string;
  company: string;
  type: string;
  description: string | null;
  deadline: Date | null;
}

interface EventRecommendation {
  id: string;
  title: string;
  description: string | null;
  location: string | null;
  startsAt: Date;
}

const PORTFOLIO_TASKS: PortfolioTaskDefinition[] = [
  {
    id: "resume-refresh",
    title: "Draft or update your resume",
    description: "Capture your work history, strengths, and recent wins in the portfolio builder.",
    url: "/portfolio",
    keywords: ["resume", "job", "application", "interview", "career", "employment"],
  },
  {
    id: "portfolio-proof",
    title: "Add a portfolio work sample",
    description: "Upload a project, award, certificate, or work sample that supports this goal.",
    url: "/portfolio",
    keywords: ["portfolio", "project", "sample", "showcase", "proof", "artifact", "award"],
  },
  {
    id: "credential-share",
    title: "Prepare something you can share",
    description: "Build a portfolio item or public credential that demonstrates progress to instructors or employers.",
    url: "/portfolio",
    keywords: ["share", "credential", "public", "employer", "presentation", "publish"],
  },
];

const CAREER_STEPS: CareerStepDefinition[] = [
  {
    id: "application-submit",
    title: "Submit an application",
    description: "Track a real job or internship application in your opportunities dashboard.",
    url: "/opportunities",
    keywords: ["job", "employment", "work", "career", "application", "interview", "resume"],
  },
  {
    id: "event-register",
    title: "Register for a career event",
    description: "Sign up for a hiring event, workshop, or employer visit tied to this goal.",
    url: "/events",
    keywords: ["event", "career fair", "workshop", "network", "employer", "recruiter", "hiring"],
  },
];

const CAREER_GOAL_KEYWORDS = [
  "job",
  "employment",
  "career",
  "application",
  "interview",
  "resume",
  "work",
  "hiring",
  "employer",
  "network",
  "event",
  "workshop",
  "internship",
];

const ONBOARDING_KEYWORDS = [
  "orientation",
  "onboarding",
  "enroll",
  "enrollment",
  "intake",
  "paperwork",
  "forms",
  "get started",
  "new student",
  "program start",
];

const FORM_MATCHERS: Array<{
  formIds: string[];
  keywords: string[];
  reason: string;
}> = [
  {
    formIds: ["student-profile", "attendance-contract", "tech-acceptable-use"],
    keywords: ONBOARDING_KEYWORDS,
    reason: "Onboarding paperwork that supports this goal",
  },
  {
    formIds: ["portfolio-checklist-tracking"],
    keywords: ["portfolio", "resume", "career", "job", "employment", "interview", "application"],
    reason: "Portfolio checklist that supports this goal",
  },
  {
    formIds: ["rtw-attendance", "spokes-module-record"],
    keywords: ["certification", "credential", "exam", "license", "badge", "readiness"],
    reason: "Certification tracking forms tied to this goal",
  },
  {
    formIds: ["support-services-fact-sheet", "dfa-wvw-25"],
    keywords: ["support", "transportation", "childcare", "wv works", "dohs", "benefits", "barrier"],
    reason: "Support-service forms that can remove barriers for this goal",
  },
  {
    formIds: ["sign-in-sheet"],
    keywords: ["attendance", "show up", "present", "hours", "participation"],
    reason: "Attendance tracking that supports this goal",
  },
];

const RECOMMENDATION_PRIORITY: Record<GoalResourceRecommendation["resourceType"], number> = {
  orientation: 1,
  form: 2,
  portfolio_task: 3,
  career_step: 4,
  platform: 5,
  certification: 6,
  document: 7,
};

function getPlatformUrl(platformId: string): string | null {
  const platform = PLATFORMS.find((item) => item.id === platformId);
  if (!platform) return null;
  return platform.loginUrl
    || platform.links.find((link) => link.audience !== "teacher")?.url
    || platform.links[0]?.url
    || null;
}

function makeFormUrl(formId: string): string {
  return buildFormDownloadUrl(formId, "view");
}

function includesKeyword(text: string, keywords: string[]): boolean {
  return keywords.some((keyword) => text.includes(keyword));
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 4);
}

function textOverlapScore(goalText: string, label: string, description: string | null): number {
  const goalTokens = new Set(tokenize(goalText));
  const sourceTokens = tokenize(`${label} ${description || ""}`);
  let score = 0;
  for (const token of sourceTokens) {
    if (goalTokens.has(token)) {
      score += 1;
    }
  }
  return score;
}

function collectFormRecommendations(goalText: string, matchedCertificationIds: string[]) {
  const recommendations = new Map<string, GoalResourceRecommendation>();
  const certificationGoal = includesKeyword(goalText, ["certification", "credential", "exam", "license", "badge", "readiness"]);

  for (const matcher of FORM_MATCHERS) {
    if (
      !includesKeyword(goalText, matcher.keywords)
      && !(matcher.formIds.includes("rtw-attendance") && certificationGoal && matchedCertificationIds.length > 0)
    ) {
      continue;
    }

    for (const formId of matcher.formIds) {
      const form = FORMS.find((entry) => entry.id === formId);
      if (!form) continue;

      recommendations.set(`form:${form.id}`, {
        resourceType: "form",
        resourceId: form.id,
        title: form.title,
        description: form.description,
        url: makeFormUrl(form.id),
        reason: matcher.reason,
      });
    }
  }

  return [...recommendations.values()];
}

function collectCertificationRecommendations(certificationIds: string[]) {
  return certificationIds.flatMap((certificationId) => {
    const certification = CERTIFICATIONS.find((entry) => entry.id === certificationId);
    if (!certification) return [];

    const url = certification.platforms
      .map((platformId) => getPlatformUrl(platformId))
      .find((value): value is string => !!value) || "/courses";

    return [{
      resourceType: "certification" as const,
      resourceId: certification.id,
      title: certification.name,
      description: certification.description,
      url,
      reason: "Certification path matched from the goal",
    }];
  });
}

function collectOrientationRecommendations(goalText: string, orientationItems: OrientationPlanItem[]) {
  const onboardingGoal = includesKeyword(goalText, ONBOARDING_KEYWORDS);

  return orientationItems
    .map((item) => ({
      item,
      score: textOverlapScore(goalText, item.label, item.description) + (onboardingGoal && item.required ? 2 : 0),
    }))
    .filter(({ item, score }) => score > 0 || (onboardingGoal && item.required))
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      if (left.item.required !== right.item.required) return left.item.required ? -1 : 1;
      return left.item.sortOrder - right.item.sortOrder;
    })
    .slice(0, onboardingGoal ? 3 : 2)
    .map(({ item }) => ({
      resourceType: "orientation" as const,
      resourceId: item.id,
      title: item.label,
      description: item.description,
      url: "/orientation",
      reason: onboardingGoal
        ? "Orientation step that supports getting started"
        : "Orientation step matched from this goal",
    }));
}

function collectPortfolioTaskRecommendations(goalText: string) {
  return PORTFOLIO_TASKS
    .filter((task) => includesKeyword(goalText, task.keywords))
    .slice(0, 2)
    .map((task) => ({
      resourceType: "portfolio_task" as const,
      resourceId: task.id,
      title: task.title,
      description: task.description,
      url: task.url,
      reason: "Portfolio work that strengthens this goal",
    }));
}

function collectCareerStepRecommendations(goalText: string) {
  return CAREER_STEPS
    .filter((step) => includesKeyword(goalText, step.keywords))
    .map((step) => ({
      resourceType: "career_step" as const,
      resourceId: step.id,
      title: step.title,
      description: step.description,
      url: step.url,
      reason: "Career action that turns this goal into an observable outcome",
    }));
}

function collectOpportunityRecommendations(
  goalText: string,
  opportunities: OpportunityRecommendation[],
) {
  const careerGoal = includesKeyword(goalText, CAREER_GOAL_KEYWORDS);

  return opportunities
    .map((opportunity) => {
      const score = textOverlapScore(
        goalText,
        `${opportunity.title} ${opportunity.company}`,
        `${opportunity.type} ${opportunity.description || ""}`,
      ) + (careerGoal ? 1 : 0);

      return { opportunity, score };
    })
    .filter(({ score }) => score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      const leftDeadline = left.opportunity.deadline?.getTime() ?? Number.POSITIVE_INFINITY;
      const rightDeadline = right.opportunity.deadline?.getTime() ?? Number.POSITIVE_INFINITY;
      return leftDeadline - rightDeadline;
    })
    .slice(0, 2)
    .map(({ opportunity }) => ({
      resourceType: "career_step" as const,
      resourceId: `opportunity:${opportunity.id}`,
      title: `Apply: ${opportunity.title}`,
      description: `${opportunity.company} • ${opportunity.type}${opportunity.deadline ? ` • deadline ${opportunity.deadline.toLocaleDateString()}` : ""}`,
      url: `/opportunities#opportunity-${opportunity.id}`,
      reason: "Live opportunity matched to this goal",
    }));
}

function collectEventRecommendations(
  goalText: string,
  events: EventRecommendation[],
) {
  const careerGoal = includesKeyword(goalText, CAREER_GOAL_KEYWORDS);

  return events
    .map((event) => {
      const score = textOverlapScore(goalText, event.title, `${event.location || ""} ${event.description || ""}`)
        + (careerGoal ? 1 : 0);
      return { event, score };
    })
    .filter(({ score }) => score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return left.event.startsAt.getTime() - right.event.startsAt.getTime();
    })
    .slice(0, 2)
    .map(({ event }) => ({
      resourceType: "career_step" as const,
      resourceId: `event:${event.id}`,
      title: `Attend: ${event.title}`,
      description: `${event.startsAt.toLocaleString()}${event.location ? ` • ${event.location}` : ""}`,
      url: `/events#event-${event.id}`,
      reason: "Upcoming event matched to this goal",
    }));
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

  const now = new Date();
  const [documents, orientationItems, opportunities, events] = await Promise.all([
    matchedPlatformIds.size > 0 || matchedCertificationIds.size > 0
      ? prisma.programDocument.findMany({
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
      : Promise.resolve([]),
    prisma.orientationItem.findMany({
      orderBy: [{ required: "desc" }, { sortOrder: "asc" }, { label: "asc" }],
      select: {
        id: true,
        label: true,
        description: true,
        required: true,
        sortOrder: true,
      },
    }),
    prisma.opportunity.findMany({
      where: { status: "open" },
      orderBy: [{ deadline: "asc" }, { createdAt: "desc" }],
      take: 12,
      select: {
        id: true,
        title: true,
        company: true,
        type: true,
        description: true,
        deadline: true,
      },
    }),
    prisma.careerEvent.findMany({
      where: {
        status: "scheduled",
        endsAt: { gte: now },
      },
      orderBy: { startsAt: "asc" },
      take: 12,
      select: {
        id: true,
        title: true,
        description: true,
        location: true,
        startsAt: true,
      },
    }),
  ]);

  return goals.map((goal) => {
    const match = matchByGoalId.get(goal.id);
    const normalizedGoal = goal.content.toLowerCase();
    const goalLinks = links
      .filter((link) => link.goalId === goal.id)
      .sort((left, right) => {
        const leftTime = new Date(left.createdAt).getTime();
        const rightTime = new Date(right.createdAt).getTime();
        return leftTime - rightTime;
      });

    const existingKeys = new Set(goalLinks.map((link) => `${link.resourceType}:${link.resourceId}`));
    const recommendations = new Map<string, GoalResourceRecommendation>();

    const addRecommendation = (recommendation: GoalResourceRecommendation) => {
      const key = `${recommendation.resourceType}:${recommendation.resourceId}`;
      if (existingKeys.has(key) || recommendations.has(key)) {
        return;
      }
      recommendations.set(key, recommendation);
    };

    if (match) {
      for (const platformId of match.platformIds) {
        const platform = PLATFORMS.find((item) => item.id === platformId);
        if (!platform) continue;

        addRecommendation({
          resourceType: "platform",
          resourceId: platform.id,
          title: platform.name,
          description: platform.description,
          url: getPlatformUrl(platform.id),
          reason: "Matched from goal keywords",
        });
      }

      for (const certification of collectCertificationRecommendations(match.certificationIds)) {
        addRecommendation(certification);
      }

      for (const document of documents) {
        const matchesPlatform = !!document.platformId && match.platformIds.includes(document.platformId);
        const matchesCertification = !!document.certificationId && match.certificationIds.includes(document.certificationId);
        if (!matchesPlatform && !matchesCertification) continue;

        addRecommendation({
          resourceType: "document",
          resourceId: document.id,
          title: document.title,
          description: document.description,
          url: `/api/documents/download?id=${document.id}&mode=view`,
          reason: matchesPlatform ? "Guide tied to a matched platform" : "Guide tied to a matched certification",
        });
      }

      for (const form of collectFormRecommendations(normalizedGoal, match.certificationIds)) {
        addRecommendation(form);
      }
    } else {
      for (const form of collectFormRecommendations(normalizedGoal, [])) {
        addRecommendation(form);
      }
    }

    for (const step of collectOrientationRecommendations(normalizedGoal, orientationItems)) {
      addRecommendation(step);
    }

    for (const task of collectPortfolioTaskRecommendations(normalizedGoal)) {
      addRecommendation(task);
    }

    for (const step of collectCareerStepRecommendations(normalizedGoal)) {
      addRecommendation(step);
    }

    for (const opportunity of collectOpportunityRecommendations(normalizedGoal, opportunities)) {
      addRecommendation(opportunity);
    }

    for (const event of collectEventRecommendations(normalizedGoal, events)) {
      addRecommendation(event);
    }

    return {
      goalId: goal.id,
      suggestions: match?.suggestions || [],
      recommendations: [...recommendations.values()]
        .sort((left, right) => {
          const priorityDelta = RECOMMENDATION_PRIORITY[left.resourceType] - RECOMMENDATION_PRIORITY[right.resourceType];
          if (priorityDelta !== 0) return priorityDelta;
          return left.title.localeCompare(right.title);
        })
        .slice(0, 8),
      links: goalLinks,
    };
  });
}
