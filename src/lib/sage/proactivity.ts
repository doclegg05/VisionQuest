// =============================================================================
// Proactive intelligence (Pillar 4).
//
// A real assistant doesn't only answer — it notices. Given the situational
// data Sage already gathers each turn, this detects the single most useful
// thing to gently raise (an appointment coming up, a stalled goal, a missing
// goal, unfinished orientation, an early-program nudge) and renders it as a
// soft prompt hint. Sage surfaces it naturally — it never nags.
//
// Pure and fully unit-tested; the snapshot module feeds it real data.
// =============================================================================

export interface ProactiveSignalInput {
  readinessScore: number;
  activeGoalCount: number;
  stalledGoalCount: number;
  orientationComplete: boolean;
  orientationRemaining: number;
  /** Hours until the next appointment, or null if none upcoming. */
  nextAppointmentInHours: number | null;
  nextAppointmentLabel: string | null;
}

export interface ProactiveSignal {
  kind:
    | "appointment_soon"
    | "stalled_goal"
    | "no_goals"
    | "orientation_incomplete"
    | "early_encouragement";
  /** Higher = more important; the highest is surfaced. */
  priority: number;
  nudge: string;
}

const APPOINTMENT_SOON_HOURS = 36;

/**
 * Detect actionable proactive signals, highest-priority first. Pure.
 */
export function detectProactiveSignals(input: ProactiveSignalInput): ProactiveSignal[] {
  const signals: ProactiveSignal[] = [];

  if (
    input.nextAppointmentInHours !== null &&
    input.nextAppointmentInHours >= 0 &&
    input.nextAppointmentInHours <= APPOINTMENT_SOON_HOURS &&
    input.nextAppointmentLabel
  ) {
    signals.push({
      kind: "appointment_soon",
      priority: 100,
      nudge: `They have an appointment coming up soon: ${input.nextAppointmentLabel}. A brief, warm reminder would help.`,
    });
  }

  if (input.stalledGoalCount > 0) {
    signals.push({
      kind: "stalled_goal",
      priority: 80,
      nudge:
        "One of their goals has stalled (no progress in a while). If it fits, gently check in on it and offer one tiny next step.",
    });
  }

  if (input.activeGoalCount === 0) {
    signals.push({
      kind: "no_goals",
      priority: 70,
      nudge: "They don't have an active goal yet. When the moment fits, offer to set one small goal together.",
    });
  }

  if (!input.orientationComplete && input.orientationRemaining > 0) {
    signals.push({
      kind: "orientation_incomplete",
      priority: 60,
      nudge: `They still have ${input.orientationRemaining} orientation step${input.orientationRemaining === 1 ? "" : "s"} left. Offer to help them finish when it's natural.`,
    });
  }

  if (input.readinessScore < 25 && input.activeGoalCount > 0) {
    signals.push({
      kind: "early_encouragement",
      priority: 40,
      nudge: "They're early in the program. Affirm a recent effort and suggest one concrete next step.",
    });
  }

  return signals.sort((a, b) => b.priority - a.priority);
}

/** The single highest-priority nudge, rendered as a prompt hint, or null. */
export function topProactiveNudge(input: ProactiveSignalInput): string | null {
  const top = detectProactiveSignals(input)[0];
  if (!top) return null;
  return (
    "PROACTIVE NUDGE (raise this naturally ONLY if it fits the flow of the conversation — " +
    "one gentle mention, never nag, and drop it if the student is focused on something else): " +
    top.nudge
  );
}
