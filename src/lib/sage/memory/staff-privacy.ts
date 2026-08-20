/**
 * Keeps teacher-subject memory from becoming a back channel for student data.
 *
 * Staff chat is full of student PII by design — buildStaffStudentContext feeds
 * real classroom records into the prompt, and instructors type student names
 * without thinking about it. A teacher-subject SageMemory row is NOT a student
 * record: it is not scoped to a classroom, it is not covered by
 * assertStaffCanManageStudent, and the RLS policy shipped in
 * 20260701141000_scope_sage_memory_teacher_rls deliberately leaves non-student
 * subject rows staff-visible *unscoped* — which was safe only while nothing
 * wrote them. Now that staff chat writes them, a student fact landing in a
 * teacher row would be readable by staff who do not manage that student.
 *
 * So the rule is absolute rather than proportional: a teacher-subject memory
 * must contain no person, no identifier, and no student circumstance at all.
 *
 * This guard is DROP-BIASED on purpose. Losing a legitimate staff preference
 * costs one memory that the next conversation will re-state; keeping one
 * student fact is a privacy incident. When in doubt it rejects.
 *
 * Layer 1 is the extraction prompt (see staff-extract.ts). This is layer 2,
 * applied at write time. Layer 3 is the same function applied at render time
 * in retrieve.ts, so a row written by some other path — a manual correction, a
 * future importer — still cannot reach a prompt.
 */

/**
 * Capitalized tokens a staff working-preference sentence may legitimately
 * contain. Everything else that starts with a capital is treated as a proper
 * noun, i.e. probably a person.
 *
 * Sentence-initial capitals are NOT exempt: "Jasmine needs a bus pass" would
 * sail through any position-aware scan, and that is exactly the sentence this
 * guard exists to stop. The cost is that staff memories must open with an
 * ordinary verb or adverb ("Prefers…", "Reviews…", "Usually…"), which is the
 * shape the extraction prompt asks for and the shape student memories already
 * have ("Wants to become a CNA.").
 *
 * Deliberately EXCLUDED even though they are ordinary words: Mark, Grace,
 * Will, May, June, Bill, Rose, Hope, Faith — every one of them is also a
 * common first name, and this list is the only thing standing between a name
 * and the prompt.
 *
 * MAINTENANCE RULE for anyone adding to this list: the only admissible test
 * is "could this token ever be a person's given or family name?" If yes, it
 * does not go in, however inconvenient. Modals and role nouns qualify because
 * nobody is named Cannot or Coordinator; ordinary-sounding words do not.
 * Every entry below was added against a specific measured false rejection,
 * not speculatively — an over-wide list is the one way this guard fails open.
 */
const SAFE_CAPITALIZED_TOKENS = new Set(
  [
    // Sentence-opening verbs the extraction prompt asks for.
    "Prefers", "Wants", "Needs", "Uses", "Works", "Runs", "Keeps", "Reviews",
    "Checks", "Asks", "Likes", "Avoids", "Schedules", "Starts", "Ends",
    "Blocks", "Sets", "Plans", "Tracks", "Handles", "Follows", "Prioritizes",
    "Teaches", "Meets", "Sends", "Reads", "Writes", "Prints", "Flags", "Logs",
    "Relies", "Tends", "Struggles", "Finds", "Focuses", "Prepares", "Requests",
    "Expects", "Reports", "Holds", "Splits", "Batches", "Answers", "Coaches",
    "Manages", "Opens", "Closes", "Limits", "Caps", "Requires", "Wraps",
    "Prefer", "Does", "Doesn't", "Has", "Is", "Was", "Believes", "Treats",
    "Defers", "Escalates", "Routes", "Confirms", "Approves", "Declines",
    "Delegates", "Records", "Documents", "Sorts", "Filters", "Groups",
    "Repeats", "Rechecks", "Waits", "Sticks", "Leaves", "Pulls", "Adds",
    // Modals and negations that open a constraint sentence. None is a name.
    "Cannot", "Can", "Can't", "Must", "Won't", "Needs", "Has to", "Have",
    // Role nouns. A student is never referred to by any of these, so they
    // carry no identifying power, and staff constraints name them constantly
    // ("Escalates placement approvals to the Coordinator").
    "Coordinator", "Coordinators", "Instructor", "Instructors", "Teacher",
    "Teachers", "Advisor", "Advisors", "Administrator", "Admin", "Staff",
    "Program", "Manager", "Supervisor", "Director", "Counselor", "Caseworker",
    // Adverbs and function words that can open a sentence.
    "Often", "Usually", "Always", "Never", "Typically", "Generally", "Rarely",
    "Sometimes", "Mostly", "Only", "Still", "Also", "Then", "When", "After",
    "Before", "During", "If", "Because", "The", "A", "An", "In", "On", "At",
    "To", "For", "With", "And", "But", "So", "As", "By", "Per", "This",
    "That", "They", "Their", "Every", "Each", "Most", "Some",
    // Program vocabulary an instructor legitimately names.
    "SPOKES", "Sage", "VisionQuest", "WorkKeys", "ServSafe", "OSHA", "CPR",
    "CNA", "GED", "HSE", "TANF", "SNAP", "WIOA", "FERPA", "ACT", "AI", "ID",
    "PDF", "CSV", "KPI", "Bring", "Your", "Game", "Ready", "Work", "Career",
    "Cluster", "Orientation", "Portfolio", "Advising", "Dashboard", "Learning",
    "Goals", "Documents", "Classes", "Khan", "Academy",
    // Weekdays — schedule facts are the most common legitimate staff memory.
    "Monday", "Mondays", "Tuesday", "Tuesdays", "Wednesday", "Wednesdays",
    "Thursday", "Thursdays", "Friday", "Fridays", "Saturday", "Saturdays",
    "Sunday", "Sundays",
  ],
);

/** Anything that looks like a contact detail or a record number. */
const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/;
const PHONE_RE = /\b\d{3}[.\-\s]?\d{3}[.\-\s]?\d{4}\b/;
/** Three or more consecutive digits: student ids, case numbers, DOBs. */
const LONG_DIGIT_RUN_RE = /\d{3,}/;

const SUBJECT_NOUN = "students?|learners?|participants?|clients?|mentees?|kids?";
const DISCLOSURE_VERB =
  "disclosed|shared|told|confided|revealed|admitted|reported|said|mentioned|complained|opened up";

/**
 * A student noun close to a disclosure verb — "a student disclosed…",
 * "one learner shared…". Plain classroom-workflow sentences that merely
 * contain "students" ("Reviews flagged students on Monday") have no
 * disclosure verb and pass.
 */
const SUBJECT_DISCLOSURE_RE = new RegExp(
  `\\b(?:${SUBJECT_NOUN})\\b(?:\\W+\\w+){0,3}\\W+\\b(?:${DISCLOSURE_VERB})\\b|\\b(?:${DISCLOSURE_VERB})\\b(?:\\W+\\w+){0,3}\\W+\\b(?:${SUBJECT_NOUN})\\b`,
  "i",
);

/**
 * Circumstance vocabulary that belongs in a student record and nowhere else.
 * Present at all ⇒ reject, with no proximity test: a staff working-preference
 * sentence has no reason to say "custody" or "eviction".
 */
const STUDENT_CIRCUMSTANCE_RE =
  /\b(custody|eviction|evicted|homeless(?:ness)?|shelter|probation|parole|arrest(?:ed)?|incarcerat\w*|court date|hearing|diagnos\w*|medication|pregnan\w*|miscarriage|domestic|abuse|assault|addiction|relapse|sober\w*|overdose|suicid\w*|self-harm|depress\w*|anxiety attack|crisis|restraining order|divorce|foster care|child support|food stamps|benefits check|utility shutoff|back rent)\b/i;

/**
 * True when `content` must not be stored as (or rendered from) a
 * teacher-subject memory. See the module header for the drop-biased rationale.
 */
export function looksLikeStudentReference(content: string): boolean {
  if (EMAIL_RE.test(content)) return true;
  if (PHONE_RE.test(content)) return true;
  if (LONG_DIGIT_RUN_RE.test(content)) return true;
  if (SUBJECT_DISCLOSURE_RE.test(content)) return true;
  if (STUDENT_CIRCUMSTANCE_RE.test(content)) return true;

  for (const token of content.split(/[^A-Za-z'’-]+/)) {
    if (!token) continue;
    if (!/^[A-Z]/.test(token)) continue;
    // Strip a possessive so "Maria's" is judged as "Maria".
    const bare = token.replace(/['’]s$/i, "");
    if (!SAFE_CAPITALIZED_TOKENS.has(bare)) return true;
  }

  return false;
}
