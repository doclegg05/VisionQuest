/**
 * Login constants for the synthetic benchmark cohort.
 *
 * Same shape and the same reasoning as `e2e/fixtures.ts`: one committed source
 * of truth for the accounts `scripts/bench/seed-cohort.ts` creates and the
 * benchmark Playwright specs log in as. Everything here is a test fixture on a
 * local or CI database, never a real credential — and because the passwords ARE
 * committed, both the cohort seed and the e2e seed refuse to run against any
 * host that does not look local or CI-scoped.
 *
 * The ids are the cohort's own (`bench_instr_1`, `bench_stu_01`), so a spec can
 * cross-reference `loadCohort()` without a lookup. The LOGIN is what
 * `/api/auth/login` takes.
 */

export const BENCH_INSTRUCTOR_PASSWORD = "Bench-cohort-teach-1!";
export const BENCH_STUDENT_PASSWORD = "Bench-cohort-stud-1!";

export interface BenchUserFixture {
  /** The cohort row's `id`, which is also the database primary key. */
  id: string;
  /** `Student.studentId` — what the login form and API take. */
  login: string;
  displayName: string;
  password: string;
}

/** The instructor who owns `bench_class_1` and every connection proposed in it. */
export const BENCH_INSTRUCTOR: BenchUserFixture = {
  id: "bench_instr_1",
  login: "bench-instructor-1",
  displayName: "Marlow Denbrook",
  password: BENCH_INSTRUCTOR_PASSWORD,
};

/**
 * The student the Connect journey spec drives.
 *
 * `bench_stu_01` is the cohort's `proposed-a` connection — a live proposal
 * waiting on the student's approval, which is exactly where that journey
 * starts. Picking a student whose connection is already sent would mean the
 * spec had to unwind state before it could begin.
 */
export const BENCH_JOURNEY_STUDENT: BenchUserFixture = {
  id: "bench_stu_01",
  login: "bench-student-01",
  displayName: "Alma Ashgrove",
  password: BENCH_STUDENT_PASSWORD,
};

/** The class those two share. */
export const BENCH_CLASS = {
  id: "bench_class_1",
  code: "bench-spokes-beckley",
  name: "Bench SPOKES Beckley",
} as const;
