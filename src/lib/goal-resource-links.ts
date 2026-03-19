export const GOAL_RESOURCE_TYPES = ["platform", "document"] as const;
export type GoalResourceType = (typeof GOAL_RESOURCE_TYPES)[number];

export const GOAL_RESOURCE_LINK_TYPES = ["recommended", "assigned"] as const;
export type GoalResourceLinkType = (typeof GOAL_RESOURCE_LINK_TYPES)[number];

export const GOAL_RESOURCE_LINK_STATUSES = [
  "suggested",
  "assigned",
  "in_progress",
  "completed",
  "blocked",
  "dismissed",
] as const;
export type GoalResourceLinkStatus = (typeof GOAL_RESOURCE_LINK_STATUSES)[number];

export const GOAL_RESOURCE_TYPE_LABELS: Record<GoalResourceType, string> = {
  platform: "Platform",
  document: "Document",
};

export const GOAL_RESOURCE_LINK_STATUS_LABELS: Record<GoalResourceLinkStatus, string> = {
  suggested: "Suggested",
  assigned: "Assigned",
  in_progress: "In Progress",
  completed: "Completed",
  blocked: "Blocked",
  dismissed: "Dismissed",
};

export interface GoalResourceRecommendation {
  resourceType: GoalResourceType;
  resourceId: string;
  title: string;
  description: string | null;
  url: string | null;
  reason: string;
}

export interface GoalResourceLinkView {
  id: string;
  goalId: string;
  resourceType: GoalResourceType;
  resourceId: string;
  title: string;
  description: string | null;
  url: string | null;
  linkType: GoalResourceLinkType;
  status: GoalResourceLinkStatus;
  dueAt: Date | string | null;
  notes: string | null;
  assignedById: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}

export interface GoalPlanEntry {
  goalId: string;
  suggestions: string[];
  recommendations: GoalResourceRecommendation[];
  links: GoalResourceLinkView[];
}

export function isGoalResourceType(value: string): value is GoalResourceType {
  return GOAL_RESOURCE_TYPES.includes(value as GoalResourceType);
}

export function isGoalResourceLinkType(value: string): value is GoalResourceLinkType {
  return GOAL_RESOURCE_LINK_TYPES.includes(value as GoalResourceLinkType);
}

export function isGoalResourceLinkStatus(value: string): value is GoalResourceLinkStatus {
  return GOAL_RESOURCE_LINK_STATUSES.includes(value as GoalResourceLinkStatus);
}

export function goalResourceStatusLabel(status: string): string {
  return isGoalResourceLinkStatus(status) ? GOAL_RESOURCE_LINK_STATUS_LABELS[status] : status;
}

export function toGoalResourceLinkView(link: {
  id: string;
  goalId: string;
  resourceType: string;
  resourceId: string;
  title: string;
  description: string | null;
  url: string | null;
  linkType: string;
  status: string;
  dueAt: Date | string | null;
  notes: string | null;
  assignedById: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}): GoalResourceLinkView | null {
  if (
    !isGoalResourceType(link.resourceType)
    || !isGoalResourceLinkType(link.linkType)
    || !isGoalResourceLinkStatus(link.status)
  ) {
    return null;
  }

  return {
    ...link,
    resourceType: link.resourceType,
    linkType: link.linkType,
    status: link.status,
  };
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function toIsoOrNull(value: Date | string | null): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : value;
}

export function serializeGoalPlanEntries(entries: GoalPlanEntry[]): GoalPlanEntry[] {
  return entries.map((entry) => ({
    ...entry,
    links: entry.links.map((link) => ({
      ...link,
      dueAt: toIsoOrNull(link.dueAt),
      createdAt: toIso(link.createdAt),
      updatedAt: toIso(link.updatedAt),
    })),
  }));
}
