import type { GoalLevel, GoalStatus } from "@/lib/goals";

export interface TestGoal {
  id: string;
  level: GoalLevel;
  content: string;
  status: GoalStatus;
  parentId: string | null;
  createdAt: string;
}

export function goal(
  id: string,
  level: GoalLevel,
  content: string,
  options: { status?: GoalStatus; parentId?: string | null } = {},
): TestGoal {
  return {
    id,
    level,
    content,
    status: options.status ?? "active",
    parentId: options.parentId ?? null,
    createdAt: "2026-09-01T12:00:00.000Z",
  };
}

/** Every `<button ...>` opening tag in server-rendered HTML. */
export function buttonTags(html: string): string[] {
  return html.match(/<button\b[^>]*>/g) ?? [];
}

/** True when a rendered opening tag carries the `disabled` attribute. */
export function isDisabled(tag: string): boolean {
  return /\sdisabled(?:=""|\s|>|\/)/.test(tag);
}

const ARIA_LABEL = /aria-label="([^"]*)"/;

export function ariaLabelOf(tag: string): string | null {
  return tag.match(ARIA_LABEL)?.[1] ?? null;
}
