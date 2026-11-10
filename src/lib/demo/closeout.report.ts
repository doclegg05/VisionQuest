/**
 * Demo closeout (readiness H10): every word the tool can say.
 *
 * Fixed sentences only. A sentence may carry a count, the database name or the
 * host. It never carries a name, a login, an email, an id or any text that came
 * from an error, because an error can quote all of those.
 */

export const REFUSALS = {
  demo_mode_on: "Demo mode is on. Turn COHORT_DEMO_MODE off in Render and let the deploy finish. Nothing was deleted.",
  cannot_see_every_row: "This database connection is limited by row level security, so it cannot see every row. Use the admin database URL. Nothing was deleted.",
  demo_class_not_owned: "A class holds the demo class code but the marked demo instructor does not own it. Nothing was deleted.",
  plan_includes_unmarked: "The plan would delete an account that is not marked as demo. Nothing was deleted.",
  unmarked_student_in_demo_class: "An account that is not marked as demo is enrolled in a demo class. Nothing was deleted.",
  unmarked_rows_on_demo_class: "Rows that belong to accounts not marked as demo are attached to a demo class. Nothing was deleted.",
  marked_staff_over_unmarked_students: "A marked demo account teaches or coordinates a class or region that has unmarked students. Nothing was deleted.",
  marked_account_on_kept_rows: "A marked demo account is named on rows that belong to other people or to the program. Nothing was deleted.",
  rows_left_pointing: "Rows would be left pointing at a deleted account or class. Nothing was deleted.",
  unlisted_rows_removed: "The deletion would remove rows the preview did not list. Nothing was deleted.",
} as const;
export type RefusalCode = keyof typeof REFUSALS;

export interface Refusal {
  readonly code: RefusalCode;
  readonly sentence: string;
  readonly count: number;
}

export const refusal = (code: RefusalCode, count: number): Refusal => ({ code, sentence: REFUSALS[code], count });
