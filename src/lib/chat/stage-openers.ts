/**
 * Canonical opening lines for each ConversationStage.
 *
 * These match the exact opening language instructed in `src/lib/sage/system-prompts.ts`
 * so that the optimistic greeting displayed before SSE arrives closely mirrors
 * what Sage will actually say. On first real SSE text chunk the optimistic bubble
 * is replaced with the live streamed content.
 *
 * Rules:
 * - No placeholder tokens (e.g. {name}) that would appear raw in the UI.
 * - Plain language, 6th-grade reading level, consistent with brand voice.
 * - teacher_assistant opener is addressed to instructors, not students.
 */

import type { ConversationStage } from "@/lib/sage/system-prompts";

export const STAGE_OPENERS: Record<ConversationStage, string> = {
  /** Phase 1 warm-up from the discovery stage prompt */
  discovery:
    "Hey! I'm Sage, your personal guide here at VisionQuest. What should I call you?",

  /** Exact opening from the onboarding stage prompt */
  onboarding:
    "Hey! I'm Sage, your personal guide here at VisionQuest. I'm here to help you build a plan. What should I call you?",

  /** BHAG stage: student already has context — skip re-intro, go straight to goal work */
  bhag: "Good to see you! Let's keep building on what you started. Tell me — what's the big dream you're working toward?",

  /** Monthly goal-setting stage */
  monthly:
    "Good to see you! Let's figure out what you can accomplish this month to move toward your big goal.",

  /** Weekly goal-setting stage */
  weekly:
    "Hey, good to see you! Let's look at what you can tackle this week to keep your momentum going.",

  /** Daily goal-setting stage */
  daily:
    "Hey! Let's figure out the most important thing you can do today to move forward.",

  /** Task breakdown stage */
  tasks:
    "Let's break that goal down into action steps so you know exactly what to do first.",

  /** Check-in stage opening (matches prompt: "Hey [name], good to see you") */
  checkin:
    "Hey, good to see you! How have things been since we last talked?",

  /** Review stage */
  review:
    "Good to see you! Before we look ahead, let's talk about what went well and what got in the way.",

  /** Orientation stage */
  orientation:
    "Hey! I'm Sage, your guide here at VisionQuest. I'll walk you through the program and help you get settled in.",

  /** General Q&A stage */
  general:
    "Hey! What can I help you with today?",

  /** Teacher/instructor assistant */
  teacher_assistant:
    "Hi! I'm Sage. I'm here to help with program knowledge, student advising, and day-to-day tasks. What do you need?",

  /** Admin assistant — addressed to program administrators, not students */
  admin_assistant:
    "Hi! I'm Sage. I can help with program usage, outcomes, reports, and policy lookups. What are you looking into?",

  /** Career profile review stage */
  career_profile_review:
    "Hey! You've got your Career Profile results back. Let's look at them together and figure out what they mean for you.",
};
