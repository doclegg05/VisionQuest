/**
 * Shared E2E fixture constants — the single source of truth for the marker
 * users/class that scripts/seed-e2e-users.ts creates and the authenticated
 * specs (a11y-authenticated, student-journey, teacher-loop) log in as.
 *
 * Marker conventions: e2e-* logins, *@test.local emails, "E2E " label
 * prefixes — everything is removable with
 * `npx tsx scripts/seed-e2e-users.ts --clean`.
 *
 * These are test fixtures on e2e databases, not real credentials.
 */

export interface E2eUserFixture {
  login: string;
  email: string;
  displayName: string;
  password: string;
}

/** Staff account (Student row with role "teacher"). */
export const E2E_TEACHER: E2eUserFixture = {
  login: "e2e-a11y-teacher",
  email: "e2e-teacher@test.local",
  displayName: "E2E A11y Teacher",
  password: "E2e-a11y-teach-1!",
};

/**
 * "Established" student: enrolled, orientation partially complete (one item
 * pending teacher verification), one confirmed goal — so authenticated pages
 * render real content and the intervention queue includes them.
 */
export const E2E_STUDENT: E2eUserFixture = {
  login: "e2e-a11y-student",
  email: "e2e-student@test.local",
  displayName: "E2E A11y Student",
  password: "E2e-a11y-stud-1!",
};

/**
 * "Day-1" student: enrolled but with NO goals, conversations, progression,
 * or orientation progress — the seed resets them every run so /welcome
 * always renders for them.
 */
export const E2E_JOURNEY_STUDENT: E2eUserFixture = {
  login: "e2e-journey-student",
  email: "e2e-journey-student@test.local",
  displayName: "E2E Journey Student",
  password: "E2e-journey-stud-1!",
};

export const E2E_CLASS = {
  code: "e2e-a11y-class",
  name: "E2E A11y Class",
} as const;
