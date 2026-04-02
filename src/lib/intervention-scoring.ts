/**
 * Intervention urgency scoring for the teacher intervention queue.
 *
 * Higher scores indicate students who need more immediate attention.
 * A fully active student with no issues returns 0.
 */

export interface StudentSignals {
  /** Days since the student last had a goal review session */
  daysSinceLastGoalReview: number;
  /** Days since the student last logged in */
  daysSinceLastLogin: number;
  /** Whether the student has completed orientation */
  orientationComplete: boolean;
  /** Orientation completion progress from 0.0 to 1.0 */
  orientationProgress: number;
  /** Total number of open alerts (includes high-severity) */
  openAlertCount: number;
  /** Number of open alerts classified as high severity */
  highSeverityAlertCount: number;
  /** Number of overdue tasks */
  overdueTaskCount: number;
  /** Number of goals that have stalled (no recent progress) */
  stalledGoalCount: number;
  /** Overall readiness score 0–100 */
  readinessScore: number;
}

// ---------------------------------------------------------------------------
// Scoring weights
// ---------------------------------------------------------------------------

const POINTS_PER_STALLED_GOAL = 15;
const POINTS_PER_HIGH_SEVERITY_ALERT = 20;
const POINTS_PER_NON_HIGH_ALERT = 5;
const POINTS_PER_LOGIN_DAY_OVER_THRESHOLD = 3;
const LOGIN_INACTIVITY_THRESHOLD_DAYS = 7;
const POINTS_PER_GOAL_REVIEW_DAY_OVER_THRESHOLD = 2;
const GOAL_REVIEW_STALENESS_THRESHOLD_DAYS = 14;
const POINTS_PER_OVERDUE_TASK = 10;
const ORIENTATION_WEIGHT = 25;
const LOW_READINESS_THRESHOLD = 40;
const LOW_READINESS_BASE = 30;
const LOW_READINESS_SCORE_MULTIPLIER = 0.5;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compute a numeric urgency score for a student based on engagement signals.
 *
 * The score is additive — each signal contributes independently. Returns 0
 * when the student is fully engaged with no outstanding issues.
 */
export function computeUrgencyScore(signals: StudentSignals): number {
  let score = 0;

  // Stalled goals
  score += signals.stalledGoalCount * POINTS_PER_STALLED_GOAL;

  // High-severity alerts
  score += signals.highSeverityAlertCount * POINTS_PER_HIGH_SEVERITY_ALERT;

  // Non-high-severity open alerts
  const nonHighAlertCount = Math.max(
    0,
    signals.openAlertCount - signals.highSeverityAlertCount,
  );
  score += nonHighAlertCount * POINTS_PER_NON_HIGH_ALERT;

  // Login inactivity (days over threshold)
  const loginDaysOver = Math.max(
    0,
    signals.daysSinceLastLogin - LOGIN_INACTIVITY_THRESHOLD_DAYS,
  );
  score += loginDaysOver * POINTS_PER_LOGIN_DAY_OVER_THRESHOLD;

  // Goal review staleness (days over threshold)
  const goalReviewDaysOver = Math.max(
    0,
    signals.daysSinceLastGoalReview - GOAL_REVIEW_STALENESS_THRESHOLD_DAYS,
  );
  score += goalReviewDaysOver * POINTS_PER_GOAL_REVIEW_DAY_OVER_THRESHOLD;

  // Overdue tasks
  score += signals.overdueTaskCount * POINTS_PER_OVERDUE_TASK;

  // Incomplete orientation: weight by remaining progress fraction
  if (!signals.orientationComplete) {
    score += ORIENTATION_WEIGHT * (1 - signals.orientationProgress);
  }

  // Low readiness penalty
  if (signals.readinessScore < LOW_READINESS_THRESHOLD) {
    score += LOW_READINESS_BASE - signals.readinessScore * LOW_READINESS_SCORE_MULTIPLIER;
  }

  return score;
}
