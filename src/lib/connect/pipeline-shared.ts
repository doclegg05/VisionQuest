// =============================================================================
// The Connection state machine — Prisma-free half.
//
// Match & Connect Phase 4, Task 4.1 (docs/superpowers/plans/
// 2026-09-05-match-and-connect.md; pipeline in the design spec §4).
//
// A Connection is the only object in this program that causes student data to
// leave it, so its lifecycle is a table rather than a pile of `if` statements
// spread across five routes. Every write goes through assertTransition(), and
// `pipeline-shared.test.ts` enumerates all 15 x 15 pairs — legal AND illegal —
// so a widening is a failing test rather than a code review someone skims.
//
// This module must never import @/lib/db: the student approval card and the
// console both render status labels.
// =============================================================================

/**
 * The pipeline from the design spec §4, plus the two escape hatches.
 *
 * `not_now` is the employer's own "no thanks" and ends the connection for this
 * lead; `withdrawn` is the student's; `closed` is the instructor's. Retention
 * runs to 90 days, after which there is nothing left to record.
 */
export const CONNECTION_STATUSES = [
  "proposed",
  "student_approved",
  "sent",
  "viewed",
  "interested",
  "not_now",
  "interview_scheduled",
  "offered",
  "hired",
  "started",
  "retained_30",
  "retained_60",
  "retained_90",
  "withdrawn",
  "closed",
] as const;

export type ConnectionStatus = (typeof CONNECTION_STATUSES)[number];

export function isConnectionStatus(value: string): value is ConnectionStatus {
  return (CONNECTION_STATUSES as readonly string[]).includes(value);
}

/**
 * Nothing leaves these. Consent revocation withdraws every NON-terminal
 * connection, so the set matters beyond bookkeeping: `retained_90` is a
 * finished success and `not_now` is a finished refusal, and rewriting either
 * to "withdrawn" months later would falsify the funnel.
 */
export const TERMINAL_CONNECTION_STATUSES = [
  "not_now",
  "retained_90",
  "withdrawn",
  "closed",
] as const;

export function isTerminalConnectionStatus(status: ConnectionStatus): boolean {
  return (TERMINAL_CONNECTION_STATUSES as readonly string[]).includes(status);
}

/**
 * The job already happened.
 *
 * Consent revocation withdraws live introductions, but it must NOT rewrite
 * these: a student who turns the setting off in October did not un-get the job
 * they started in September, and marking a real placement "withdrawn" would
 * corrupt the grant KPI report and the DoHS export as well as the student's own
 * record. Revoking stops future sharing; it does not edit history.
 */
export const POST_HIRE_STATUSES = [
  "hired",
  "started",
  "retained_30",
  "retained_60",
  "retained_90",
] as const;

export function isPostHireStatus(status: ConnectionStatus): boolean {
  return (POST_HIRE_STATUSES as readonly string[]).includes(status);
}

/** Student-facing wording, grade 6. Used by the approval card and /memory. */
export const CONNECTION_STATUS_LABELS: Record<ConnectionStatus, string> = {
  proposed: "Waiting for you to say OK",
  student_approved: "You said OK. Your teacher will send it.",
  sent: "Sent to the employer",
  viewed: "The employer opened it",
  interested: "They want to meet you",
  not_now: "They said not right now",
  interview_scheduled: "Your meeting is set",
  offered: "They offered you the job",
  hired: "You got the job",
  started: "You started work",
  retained_30: "Still working — 30 days",
  retained_60: "Still working — 60 days",
  retained_90: "Still working — 90 days",
  withdrawn: "You took this back",
  closed: "Your teacher closed this",
};

/**
 * Every legal move.
 *
 * Three shapes are deliberate rather than incidental:
 *
 *   - `sent` may go straight to `interested` or `not_now` without passing
 *     through `viewed`. The employer page records the view before it renders
 *     the buttons, so in practice `viewed` always happens first — but if that
 *     one write fails, an employer who taps a button must not be told "no".
 *     Losing a view timestamp is a reporting gap; losing the employer's answer
 *     is the whole product.
 *   - `sent` and `viewed` may go straight to `hired`. Employers talk to people:
 *     one who rings the instructor, meets the candidate at the shop and hires
 *     them, then comes back to the link, must be able to say so. Refusing that
 *     would not prevent the hire, only the record of it.
 *   - `hired` does NOT accept another employer response. A token replay after
 *     a hire is refused here, not only by the link's active-status filter.
 *
 * `interested` is a RESTING state, not a passing one (design spec §4): an
 * employer who says yes but picks no slot stops there, and the instructor
 * follows up. That is why `recordInterested` writes it as its own transition
 * before booking, rather than jumping to `interview_scheduled`.
 */
export const ALLOWED_TRANSITIONS: Record<ConnectionStatus, readonly ConnectionStatus[]> = {
  proposed: ["student_approved", "withdrawn", "closed"],
  student_approved: ["sent", "withdrawn", "closed"],
  sent: ["viewed", "interested", "not_now", "hired", "withdrawn", "closed"],
  viewed: ["interested", "not_now", "hired", "withdrawn", "closed"],
  interested: ["interview_scheduled", "offered", "hired", "not_now", "withdrawn", "closed"],
  interview_scheduled: ["offered", "hired", "not_now", "withdrawn", "closed"],
  offered: ["hired", "not_now", "withdrawn", "closed"],
  hired: ["started", "withdrawn", "closed"],
  started: ["retained_30", "withdrawn", "closed"],
  retained_30: ["retained_60", "withdrawn", "closed"],
  retained_60: ["retained_90", "withdrawn", "closed"],
  retained_90: [],
  not_now: [],
  withdrawn: [],
  closed: [],
};

/**
 * The subset a STUDENT may drive, which is also what the RLS UPDATE policy
 * admits: approve their own proposal, or take it back. A student never marks
 * a connection sent, viewed, or answered — those are the instructor's and the
 * employer's facts about the world.
 */
export const STUDENT_ALLOWED_TRANSITIONS: Record<
  ConnectionStatus,
  readonly ConnectionStatus[]
> = {
  proposed: ["student_approved", "withdrawn"],
  student_approved: ["withdrawn"],
  sent: ["withdrawn"],
  viewed: ["withdrawn"],
  interested: ["withdrawn"],
  interview_scheduled: ["withdrawn"],
  offered: ["withdrawn"],
  hired: ["withdrawn"],
  started: ["withdrawn"],
  retained_30: ["withdrawn"],
  retained_60: ["withdrawn"],
  retained_90: [],
  not_now: [],
  withdrawn: [],
  closed: [],
};

/**
 * While the employer link still means something.
 *
 * Narrower than "not terminal" on purpose: after `hired` there is nothing left
 * for the employer to say, so a second tap on the emailed link renders the
 * same neutral "no longer active" page an expired token gets, rather than a
 * live candidate packet sitting on the open web indefinitely.
 */
export const EMPLOYER_LINK_ACTIVE_STATUSES = [
  "sent",
  "viewed",
  "interested",
  "interview_scheduled",
  "offered",
] as const;

export function isEmployerLinkActive(status: ConnectionStatus): boolean {
  return (EMPLOYER_LINK_ACTIVE_STATUSES as readonly string[]).includes(status);
}

/** Who caused a transition. Employers act through a token, never a session. */
export const CONNECTION_ACTOR_TYPES = [
  "student",
  "teacher",
  "admin",
  "employer",
  "system",
] as const;
export type ConnectionActorType = (typeof CONNECTION_ACTOR_TYPES)[number];

export class TransitionNotAllowedError extends Error {
  readonly from: ConnectionStatus;
  readonly to: ConnectionStatus;

  constructor(from: ConnectionStatus, to: ConnectionStatus) {
    super(`A connection cannot go from "${from}" to "${to}".`);
    this.name = "TransitionNotAllowedError";
    this.from = from;
    this.to = to;
  }
}

export function canTransition(from: ConnectionStatus, to: ConnectionStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

/** Throws unless the move is in the table. Called before every status write. */
export function assertTransition(from: ConnectionStatus, to: ConnectionStatus): void {
  if (!canTransition(from, to)) throw new TransitionNotAllowedError(from, to);
}

export function canStudentTransition(from: ConnectionStatus, to: ConnectionStatus): boolean {
  return STUDENT_ALLOWED_TRANSITIONS[from].includes(to);
}

/** Throws unless the STUDENT specifically may make this move. */
export function assertStudentTransition(
  from: ConnectionStatus,
  to: ConnectionStatus,
): void {
  if (!canStudentTransition(from, to)) throw new TransitionNotAllowedError(from, to);
}

/** The employer's three answers, in the order the response page shows them. */
export const EMPLOYER_RESPONSES = ["interested", "not_now", "hired"] as const;
export type EmployerResponse = (typeof EMPLOYER_RESPONSES)[number];

/**
 * The statuses a student sees on their own Career page as a live connection.
 *
 * Everything after they approved and before it ended. `proposed` is excluded
 * because that is the approval card's job, and the terminal statuses are
 * excluded because there is nothing left to do about them.
 *
 * This set exists because of a real gap: the approval card promised "You can
 * take it back any time" while nothing between approval and send showed the
 * connection at all, so there was no screen on which to take it back.
 */
export const STUDENT_VISIBLE_CONNECTION_STATUSES = CONNECTION_STATUSES.filter(
  (status) => status !== "proposed" && !isTerminalConnectionStatus(status),
);

/**
 * What the student is told about a connection, in their own words.
 *
 * Every phrase names the actor the student is waiting on, because "where is
 * this up to" is the only question this line has to answer. `employerName` is
 * interpolated where the EMPLOYER acted; a missing name degrades to "the
 * employer" rather than leaving a gap or printing "undefined".
 */
export function connectionStatusPhrase(
  status: ConnectionStatus,
  employerName: string,
): string {
  const employer = employerName.trim() || "the employer";
  switch (status) {
    case "proposed":
      return "Waiting for you to say OK";
    case "student_approved":
      return "Waiting for your teacher to send it";
    case "sent":
      return `Sent to ${employer}`;
    case "viewed":
      return `${employer} opened it`;
    case "interested":
      return `${employer} wants to meet you`;
    case "not_now":
      return `${employer} said not right now`;
    case "interview_scheduled":
      return "Your meeting is set";
    case "offered":
      return `${employer} offered you the job`;
    case "hired":
      return `You got the job at ${employer}`;
    case "started":
      return "You started work";
    case "retained_30":
      return "Still working after 30 days";
    case "retained_60":
      return "Still working after 60 days";
    case "retained_90":
      return "Still working after 90 days";
    case "withdrawn":
      return "You took this back";
    case "closed":
      return "Your teacher closed this";
  }
}

/**
 * What the student is told after they take one back.
 *
 * Split on whether the packet had actually gone: before it is sent, the honest
 * message is that nothing left the program; after, it is that the employer was
 * told. Telling a student "we told your teacher not to send this" about a
 * packet an employer has already read would be a lie they might act on.
 */
export function withdrawConfirmation(
  status: ConnectionStatus,
  employerName: string,
): string {
  const employer = employerName.trim() || "the employer";
  if (status === "proposed" || status === "student_approved") {
    return "Done. We told your teacher not to send this.";
  }
  return `Done. We told ${employer} you changed your mind.`;
}
