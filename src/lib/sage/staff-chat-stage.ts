import { isCoordinatorRole } from "@/lib/org-roles";
import type { ConversationStage } from "./stage";

export type StaffChatStage = Extract<
  ConversationStage,
  "admin_assistant" | "coordinator_assistant" | "teacher_assistant"
>;

/**
 * The staff prompt stage for a chat session's role, or null for the student
 * path. Both coordinator roles take the coordinator path: a program
 * coordinator that fell through to the student path would be crisis-scanned
 * as a student and given the student coaching prompt about itself.
 */
export function staffChatStageFor(role: string): StaffChatStage | null {
  if (role === "admin") return "admin_assistant";
  if (role === "teacher") return "teacher_assistant";
  if (isCoordinatorRole(role)) return "coordinator_assistant";
  return null;
}
