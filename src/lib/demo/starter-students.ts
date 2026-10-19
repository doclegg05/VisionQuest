import type { GoalLevel } from "@/lib/goals";
import { DEMO_STARTER_LOGIN_PREFIX } from "./config";

/**
 * The four mock students every demo class starts with, so the instructor's
 * dashboard has something to show before the first visitor arrives. They sit at
 * different points: just started, partway through orientation, goals set, and
 * close to finishing.
 */

export interface StarterGoalSpec {
  level: GoalLevel;
  content: string;
  status: "active" | "completed";
}

export interface StarterStudentSpec {
  login: string;
  displayName: string;
  /** Share of the orientation items, taken in sortOrder, this student has completed. */
  orientationShare: 0 | 0.5 | 1;
  /** Listed top down: each goal hangs under the one before it. */
  goals: readonly StarterGoalSpec[];
  /** Whether the student has already finished the welcome flow. */
  welcomeComplete: boolean;
}

export const STARTER_STUDENTS: readonly StarterStudentSpec[] = [
  {
    login: `${DEMO_STARTER_LOGIN_PREFIX}1`,
    displayName: "Maya Torres",
    orientationShare: 0,
    goals: [],
    welcomeComplete: false,
  },
  {
    login: `${DEMO_STARTER_LOGIN_PREFIX}2`,
    displayName: "Devon Price",
    orientationShare: 0.5,
    goals: [],
    welcomeComplete: true,
  },
  {
    login: `${DEMO_STARTER_LOGIN_PREFIX}3`,
    displayName: "Keisha Grant",
    orientationShare: 1,
    goals: [
      { level: "bhag", content: "Work as a medical assistant at a clinic near home", status: "active" },
      { level: "monthly", content: "Finish the IC3 Digital Literacy course", status: "active" },
    ],
    welcomeComplete: true,
  },
  {
    login: `${DEMO_STARTER_LOGIN_PREFIX}4`,
    displayName: "Luis Ortega",
    orientationShare: 1,
    goals: [
      { level: "bhag", content: "Get a full-time job in warehouse logistics", status: "active" },
      { level: "monthly", content: "Earn my forklift certification", status: "completed" },
      { level: "weekly", content: "Apply to three warehouse jobs", status: "active" },
    ],
    welcomeComplete: true,
  },
];
