/* eslint-disable @typescript-eslint/no-explicit-any -- mock.fn() scaffolding is intentionally loose across the shared prisma + notification mocks. */
import assert from "node:assert/strict";
import test, { before, beforeEach, describe, it, mock } from "node:test";
import { parseWellbeingCardSummary } from "./wellbeing-card";

// ---------------------------------------------------------------------------
// Module mocks (must be registered before crisis-detection is imported)
// ---------------------------------------------------------------------------

const mockEnrollmentFindMany = mock.fn() as any;
const mockStudentFindUnique = mock.fn() as any;
const mockStudentFindMany = mock.fn() as any;
const mockAlertUpsert = mock.fn() as any;
const mockMoodFindFirst = mock.fn() as any;
const mockSendNotification = mock.fn() as any;
const mockEnqueueJob = mock.fn() as any;

mock.module("@/lib/db", {
  namedExports: {
    prisma: {
      studentClassEnrollment: { findMany: mockEnrollmentFindMany },
      student: { findUnique: mockStudentFindUnique, findMany: mockStudentFindMany },
      studentAlert: { upsert: mockAlertUpsert },
      moodEntry: { findFirst: mockMoodFindFirst },
    },
  },
});

mock.module("@/lib/logger", {
  namedExports: {
    logger: {
      error: () => {},
      info: () => {},
      warn: () => {},
      debug: () => {},
    },
  },
});

mock.module("@/lib/notifications", {
  namedExports: { sendNotificationWithCooldown: mockSendNotification },
});

mock.module("@/lib/jobs", {
  namedExports: { enqueueJobWithCooldown: mockEnqueueJob },
});

type CrisisModule = typeof import("./crisis-detection");
let detectCrisisSignal: CrisisModule["detectCrisisSignal"];
let recordWellbeingConcern: CrisisModule["recordWellbeingConcern"];

before(async () => {
  const mod = await import("./crisis-detection");
  detectCrisisSignal = mod.detectCrisisSignal;
  recordWellbeingConcern = mod.recordWellbeingConcern;
});

const SKIP_IN_CI = process.version.startsWith("v20.");

// ---------------------------------------------------------------------------
// Positive cases — must be caught (favor recall for safety)
// ---------------------------------------------------------------------------

const SHOULD_MATCH: { text: string; category: string }[] = [
  { text: "honestly I just want to kill myself", category: "self_harm" },
  { text: "sometimes I think about killing myself", category: "self_harm" },
  { text: "I want to end my life", category: "self_harm" },
  { text: "I'm done, I want to end it all", category: "self_harm" },
  { text: "I've been having suicidal thoughts", category: "self_harm" },
  { text: "maybe suicide is the only way out", category: "self_harm" },
  { text: "I just want to die", category: "self_harm" },
  { text: "I wish I was dead", category: "self_harm" },
  { text: "everyone would be better off dead without me", category: "self_harm" },
  { text: "there's no reason to live anymore", category: "self_harm" },
  { text: "I don't want to live like this", category: "self_harm" },
  { text: "I can't go on", category: "self_harm" },
  { text: "I've been cutting myself again", category: "self_harm" },
  { text: "I want to hurt myself", category: "self_harm" },
  { text: "I keep thinking about self-harm", category: "self_harm" },
  { text: "Everyone in my life would honestly be better off if I just disappeared.", category: "self_harm" },
  { text: "everyone would be better off without me", category: "self_harm" },
  { text: "some days I just want to disappear", category: "self_harm" },
  { text: "I want to hurt someone", category: "harm_others" },
  { text: "I'm going to kill him", category: "harm_others" },
  { text: "my boyfriend hits me at home", category: "abuse" },
  { text: "I think I'm being abused", category: "abuse" },
];

for (const { text, category } of SHOULD_MATCH) {
  test(`detectCrisisSignal flags: "${text}"`, () => {
    const result = detectCrisisSignal(text);
    assert.equal(result.matched, true, `expected a match for: ${text}`);
    assert.equal(result.category, category);
  });
}

// ---------------------------------------------------------------------------
// Negative cases — must NOT false-positive on common idioms
// ---------------------------------------------------------------------------

const SHOULD_NOT_MATCH = [
  "I'm dying to see my certificate results",
  "this is a killer deal on the course",
  "I'm dead tired after that shift",
  "my goal is to live a better life",
  "I want to live in a bigger city someday",
  "that test almost killed me lol",
  "I need to cut my spending this month",
  "I want to hurt my chances? no, I want to improve them",
  "the error message disappeared after I logged back in",
  "my nerves disappeared once the interview started",
  "",
  "I'm feeling great today, ready to go",
];

for (const text of SHOULD_NOT_MATCH) {
  test(`detectCrisisSignal ignores: "${text}"`, () => {
    const result = detectCrisisSignal(text);
    assert.equal(result.matched, false, `unexpected match for: ${text}`);
    assert.equal(result.category, null);
  });
}

test("detectCrisisSignal is case-insensitive", () => {
  assert.equal(detectCrisisSignal("I WANT TO KILL MYSELF").matched, true);
});

test("detectCrisisSignal handles non-string input safely", () => {
  // @ts-expect-error — intentionally passing a non-string to verify the guard
  assert.equal(detectCrisisSignal(null).matched, false);
  // @ts-expect-error — intentionally passing a non-string to verify the guard
  assert.equal(detectCrisisSignal(undefined).matched, false);
});

// ---------------------------------------------------------------------------
// Spanish coverage (P2-7) — positive cases, accented AND unaccented spellings.
// Students often type without accents ("dano", "mi", "esta", "mas"), so both
// forms must be caught. Favor recall, same as the English set.
// ---------------------------------------------------------------------------

const SPANISH_SHOULD_MATCH: { text: string; category: string }[] = [
  // self_harm — accented / standard spelling
  { text: "ya no aguanto, me quiero morir", category: "self_harm" },
  { text: "quiero morirme", category: "self_harm" },
  { text: "quisiera morir", category: "self_harm" },
  { text: "a veces pienso en matarme", category: "self_harm" },
  { text: "me quiero matar", category: "self_harm" },
  { text: "quiero quitarme la vida", category: "self_harm" },
  { text: "he pensado en suicidarme", category: "self_harm" },
  { text: "tengo pensamientos suicidas", category: "self_harm" },
  { text: "quiero acabar con mi vida", category: "self_harm" },
  { text: "voy a terminar con mi vida", category: "self_harm" },
  { text: "no quiero vivir así", category: "self_harm" },
  { text: "no quiero seguir viviendo", category: "self_harm" },
  { text: "ya no vale la pena vivir", category: "self_harm" },
  { text: "la vida no vale la pena", category: "self_harm" },
  { text: "quiero hacerme daño", category: "self_harm" },
  { text: "me quiero hacer daño otra vez", category: "self_harm" },
  { text: "voy a lastimarme", category: "self_harm" },
  { text: "quisiera estar muerta", category: "self_harm" },
  { text: "estaría mejor muerto", category: "self_harm" },
  // Ambiguous-but-alerting: sensitivity deliberately matched to the English
  // "can't go on", which is equally ambiguous and included.
  { text: "ya no puedo más", category: "self_harm" },
  // self_harm — unaccented typing
  { text: "quiero hacerme dano", category: "self_harm" },
  { text: "ya no puedo mas con todo esto", category: "self_harm" },
  { text: "estaria mejor muerta", category: "self_harm" },
  // harm_others — accented / standard spelling
  { text: "quiero hacerle daño a mi supervisor", category: "harm_others" },
  { text: "quiero matar a mi jefe", category: "harm_others" },
  { text: "lo voy a matar", category: "harm_others" },
  { text: "quiero matarlo", category: "harm_others" },
  { text: "voy a lastimar a alguien", category: "harm_others" },
  { text: "quiero lastimar a alguien si no paran", category: "harm_others" },
  // harm_others — unaccented
  { text: "voy a hacerles dano a todos", category: "harm_others" },
  // abuse — accented / standard spelling
  { text: "mi esposo me pega", category: "abuse" },
  { text: "me golpea cuando llega a casa", category: "abuse" },
  { text: "mi pareja me maltrata", category: "abuse" },
  // Trailing accented letter before punctuation — exercises the lookahead
  // guard that replaces the (ASCII-only) \b after "mí".
  { text: "mi padrastro abusa de mí.", category: "abuse" },
  { text: "mi novio me amenaza si salgo", category: "abuse" },
  { text: "tengo miedo de mi esposo", category: "abuse" },
  { text: "le tengo miedo a mi pareja", category: "abuse" },
  { text: "me está golpeando otra vez", category: "abuse" },
  // abuse — unaccented
  { text: "abusa de mi y no se que hacer", category: "abuse" },
  { text: "abusaron de mi cuando era nina", category: "abuse" },
  { text: "mi novio me pego anoche", category: "abuse" },
  { text: "me esta pegando de nuevo", category: "abuse" },
];

for (const { text, category } of SPANISH_SHOULD_MATCH) {
  test(`detectCrisisSignal flags (es): "${text}"`, () => {
    const result = detectCrisisSignal(text);
    assert.equal(result.matched, true, `expected a match for: ${text}`);
    assert.equal(result.category, category);
  });
}

// ---------------------------------------------------------------------------
// Spanish negative cases — benign everyday phrasing must NOT alert.
// ---------------------------------------------------------------------------

const SPANISH_SHOULD_NOT_MATCH = [
  "quiero vivir en una ciudad más grande algún día",
  "estoy muerta de cansancio después del turno",
  "me muero de hambre, ¿cuándo es el descanso?",
  // "matar el tiempo" (kill time): the harm_others patterns require a person
  // object (clitic or personal "a"), mirroring the English object list.
  "voy a matar el tiempo antes de la clase",
  // Haircut, not self-injury — the pattern requires "cortarme las venas".
  "voy a cortarme el pelo este fin de semana",
  "no hay que abusar del café",
  // "tengo miedo de mi ..." is bounded to partner nouns.
  "tengo miedo de mi examen final",
  "quiero terminar el curso este mes",
];

for (const text of SPANISH_SHOULD_NOT_MATCH) {
  test(`detectCrisisSignal ignores (es): "${text}"`, () => {
    const result = detectCrisisSignal(text);
    assert.equal(result.matched, false, `unexpected match for: ${text}`);
    assert.equal(result.category, null);
  });
}

// SENSITIVITY DECISION (documented, not a bug): "quiero morir de risa"
// ("dying of laughter") DOES match. The English set has exactly the same
// behavior — "want to die" matches "I want to die laughing" — and the module's
// locked design errs toward alerting: a teacher dismissing a false positive is
// cheap; a missed crisis is not. This test pins the parity in both languages.
test("detectCrisisSignal idiom sensitivity matches English (errs toward alerting)", () => {
  assert.equal(detectCrisisSignal("I want to die laughing at this meme").matched, true);
  const result = detectCrisisSignal("quiero morir de risa con este video");
  assert.equal(result.matched, true);
  assert.equal(result.category, "self_harm");
});

test("detectCrisisSignal is case-insensitive for accented Spanish", () => {
  assert.equal(detectCrisisSignal("ME QUIERO MORIR").matched, true);
  assert.equal(detectCrisisSignal("MI PADRASTRO ABUSA DE MÍ").matched, true);
});

test("detectCrisisSignal classifies Spanish self-directed phrasing as self_harm, not harm_others", () => {
  // "quiero matarme" must resolve via the earlier self_harm entry even though
  // a harm_others "quiero matar..." pattern also exists.
  const result = detectCrisisSignal("quiero matarme");
  assert.equal(result.matched, true);
  assert.equal(result.category, "self_harm");
});

// ---------------------------------------------------------------------------
// recordWellbeingConcern — notification routing.
// SAFETY: the audience must never be narrower than "all active teachers" on
// any failure path. Assigned instructors are a scoping optimization only.
// ---------------------------------------------------------------------------

const ALL_TEACHERS = [
  { id: "teacher-all-1", email: "all1@example.test" },
  { id: "teacher-all-2", email: "all2@example.test" },
];

function enrollmentWithInstructors(
  instructors: { id: string; email: string | null; isActive: boolean }[],
) {
  return { class: { instructors: instructors.map((instructor) => ({ instructor })) } };
}

function notifiedIds(): string[] {
  return mockSendNotification.mock.calls.map((call: any) => call.arguments[0]);
}

function emailedTo(): string[] {
  return mockEnqueueJob.mock.calls.map((call: any) => call.arguments[0].payload.to);
}

function resetWellbeingMocks() {
  mockEnrollmentFindMany.mock.resetCalls();
  mockStudentFindUnique.mock.resetCalls();
  mockStudentFindMany.mock.resetCalls();
  mockAlertUpsert.mock.resetCalls();
  mockMoodFindFirst.mock.resetCalls();
  mockSendNotification.mock.resetCalls();
  mockEnqueueJob.mock.resetCalls();

  mockEnrollmentFindMany.mock.mockImplementation(async () => []);
  mockStudentFindUnique.mock.mockImplementation(async () => ({
    displayName: "Jane Doe",
    studentId: "S-001",
  }));
  mockStudentFindMany.mock.mockImplementation(async () => ALL_TEACHERS);
  mockAlertUpsert.mock.mockImplementation(async () => ({}));
  mockMoodFindFirst.mock.mockImplementation(async () => null);
  mockSendNotification.mock.mockImplementation(async () => ({ sent: true }));
  mockEnqueueJob.mock.mockImplementation(async () => ({ enqueued: true }));
}

describe("recordWellbeingConcern", { skip: SKIP_IN_CI }, () => {
  beforeEach(resetWellbeingMocks);

  it("notifies only the student's assigned instructors when they resolve", async () => {
    mockEnrollmentFindMany.mock.mockImplementation(async () => [
      enrollmentWithInstructors([
        { id: "instructor-1", email: "one@example.test", isActive: true },
        { id: "instructor-2", email: null, isActive: true },
      ]),
      enrollmentWithInstructors([
        // Duplicate across classes — must be deduped, not double-notified.
        { id: "instructor-1", email: "one@example.test", isActive: true },
        // Inactive account — must be excluded.
        { id: "instructor-3", email: "gone@example.test", isActive: false },
      ]),
    ]);

    await recordWellbeingConcern({
      studentId: "student-1",
      conversationId: "conv-1",
      reason: "message_signal",
    });

    assert.equal(mockAlertUpsert.mock.callCount(), 1, "CRITICAL alert row is always created");
    assert.deepEqual(notifiedIds().sort(), ["instructor-1", "instructor-2"]);
    assert.deepEqual(emailedTo(), ["one@example.test"], "no email for instructors without one");
    assert.equal(
      mockStudentFindMany.mock.callCount(),
      0,
      "all-teachers fallback query must not run when instructors resolve",
    );

    // Channel content/cooldowns preserved: in-app 12h cooldown, email job 12h.
    const notifyCall = mockSendNotification.mock.calls[0].arguments;
    assert.equal(notifyCall[1].type, "wellbeing.concern");
    assert.equal(notifyCall[2], 12);
    const emailJob = mockEnqueueJob.mock.calls[0].arguments[0];
    assert.equal(emailJob.type, "send_email");
    assert.equal(emailJob.cooldownHours, 12);
    assert.match(emailJob.payload.text, /No student message text is included/);
  });

  it("falls back to ALL active teachers when the student has no enrollments", async () => {
    mockEnrollmentFindMany.mock.mockImplementation(async () => []);

    await recordWellbeingConcern({
      studentId: "student-1",
      conversationId: "conv-1",
      reason: "message_signal",
    });

    assert.equal(mockStudentFindMany.mock.callCount(), 1);
    const fallbackWhere = mockStudentFindMany.mock.calls[0].arguments[0].where;
    assert.deepEqual(fallbackWhere, { role: "teacher", isActive: true });
    assert.deepEqual(notifiedIds().sort(), ["teacher-all-1", "teacher-all-2"]);
    assert.deepEqual(emailedTo().sort(), ["all1@example.test", "all2@example.test"]);
    assert.equal(mockAlertUpsert.mock.callCount(), 1);
  });

  it("falls back to ALL active teachers when every assigned instructor is inactive", async () => {
    mockEnrollmentFindMany.mock.mockImplementation(async () => [
      enrollmentWithInstructors([
        { id: "instructor-3", email: "gone@example.test", isActive: false },
      ]),
    ]);

    await recordWellbeingConcern({
      studentId: "student-1",
      conversationId: "conv-1",
      reason: "low_mood",
    });

    assert.deepEqual(notifiedIds().sort(), ["teacher-all-1", "teacher-all-2"]);
    assert.equal(mockStudentFindMany.mock.callCount(), 1);
  });

  it("falls back to ALL active teachers when instructor resolution throws", async () => {
    mockEnrollmentFindMany.mock.mockImplementation(async () => {
      throw new Error("db exploded");
    });

    await recordWellbeingConcern({
      studentId: "student-1",
      conversationId: "conv-1",
      reason: "message_signal",
    });

    assert.equal(mockStudentFindMany.mock.callCount(), 1);
    assert.deepEqual(notifiedIds().sort(), ["teacher-all-1", "teacher-all-2"]);
    assert.deepEqual(emailedTo().sort(), ["all1@example.test", "all2@example.test"]);
    assert.equal(mockAlertUpsert.mock.callCount(), 1, "alert row still created on fallback");
  });

  it("still creates the CRITICAL alert and never throws when the notify path fails entirely", async () => {
    mockStudentFindUnique.mock.mockImplementation(async () => {
      throw new Error("student lookup down");
    });

    await assert.doesNotReject(
      recordWellbeingConcern({
        studentId: "student-1",
        conversationId: null,
        reason: "message_signal",
      }),
    );

    assert.equal(mockAlertUpsert.mock.callCount(), 1);
  });
});

// ---------------------------------------------------------------------------
// Crisis context card (P1-5).
// PRIVACY (locked): teachers have NO transcript access, so the alert must be
// actionable on its own — category + time + recent mood + response checklist,
// and NEVER any student message text in any payload.
// ---------------------------------------------------------------------------

// A representative raw student message. recordWellbeingConcern never receives
// message text by design; this guards against a future regression that leaks
// it into any alert / notification / email payload.
const RAW_STUDENT_MESSAGE = "honestly I just want to kill myself tonight";
const FIXED_NOW = new Date("2026-07-20T14:32:00.000Z");

function upsertArgs() {
  return mockAlertUpsert.mock.calls[0].arguments[0];
}

describe("crisis context card", { skip: SKIP_IN_CI }, () => {
  beforeEach(resetWellbeingMocks);

  it("stores a structured card with category, timestamp, and checklist in the alert summary", async () => {
    await recordWellbeingConcern({
      studentId: "student-1",
      conversationId: "conv-1",
      reason: "message_signal",
      category: "self_harm",
      now: FIXED_NOW,
    });

    const args = upsertArgs();
    const summary = args.create.summary;
    assert.match(summary, /Signal: Self-harm language/);
    assert.match(summary, /Detected: 2026-07-20 14:32 UTC/);
    assert.match(summary, /Recommended response:/);
    assert.match(summary, /Reach the student today, in person or by phone/);
    assert.match(summary, /call 911/);
    assert.match(summary, /988 Suicide & Crisis Lifeline/);
    assert.match(summary, /Document your outreach in case notes/);

    // The same-day update branch refreshes the card too.
    assert.equal(args.update.summary, summary);

    // The card round-trips through the UI parser.
    const parsed = parseWellbeingCardSummary(summary);
    assert.ok(parsed, "summary must parse as a structured card");
    assert.equal(parsed.categoryLabel, "Self-harm language");
    assert.equal(parsed.detectedLabel, "2026-07-20 14:32 UTC");
    assert.equal(parsed.moodLabel, null);
    assert.equal(parsed.checklist.length, 4);
  });

  it("labels each crisis category and low_mood correctly", async () => {
    const cases = [
      { reason: "message_signal", category: "harm_others", label: "Harm-to-others language" },
      { reason: "message_signal", category: "abuse", label: "Possible abuse disclosure" },
      { reason: "low_mood", category: null, label: "Very low mood score" },
    ] as const;

    for (const { reason, category, label } of cases) {
      mockAlertUpsert.mock.resetCalls();
      await recordWellbeingConcern({
        studentId: "student-1",
        conversationId: "conv-1",
        reason,
        category,
        now: FIXED_NOW,
      });
      assert.match(upsertArgs().create.summary, new RegExp(`Signal: ${label}`));
    }
  });

  it("includes the most recent mood entry when one exists within 14 days", async () => {
    mockMoodFindFirst.mock.mockImplementation(async () => ({
      score: 2,
      extractedAt: new Date("2026-07-12T09:00:00.000Z"),
    }));

    await recordWellbeingConcern({
      studentId: "student-1",
      conversationId: "conv-1",
      reason: "message_signal",
      category: "self_harm",
      now: FIXED_NOW,
    });

    const summary = upsertArgs().create.summary;
    assert.match(summary, /Recent mood: 2\/10 \(2026-07-12\)/);
    assert.equal(parseWellbeingCardSummary(summary)?.moodLabel, "2/10 (2026-07-12)");

    // The lookup itself must be scoped to the student and bounded to 14 days.
    const where = mockMoodFindFirst.mock.calls[0].arguments[0].where;
    assert.equal(where.studentId, "student-1");
    const expectedLookback = new Date(FIXED_NOW.getTime() - 14 * 24 * 60 * 60 * 1000);
    assert.equal(where.extractedAt.gte.getTime(), expectedLookback.getTime());
  });

  it("omits the mood line when no entry exists within the lookback window", async () => {
    mockMoodFindFirst.mock.mockImplementation(async () => null);

    await recordWellbeingConcern({
      studentId: "student-1",
      conversationId: "conv-1",
      reason: "message_signal",
      category: "self_harm",
      now: FIXED_NOW,
    });

    const summary = upsertArgs().create.summary;
    assert.doesNotMatch(summary, /Recent mood:/);
    assert.equal(parseWellbeingCardSummary(summary)?.moodLabel, null);
  });

  it("still creates the full card when the mood lookup fails", async () => {
    mockMoodFindFirst.mock.mockImplementation(async () => {
      throw new Error("mood table down");
    });

    await assert.doesNotReject(
      recordWellbeingConcern({
        studentId: "student-1",
        conversationId: "conv-1",
        reason: "message_signal",
        category: "self_harm",
        now: FIXED_NOW,
      }),
    );

    assert.equal(mockAlertUpsert.mock.callCount(), 1);
    const summary = upsertArgs().create.summary;
    assert.match(summary, /Signal: Self-harm language/);
    assert.doesNotMatch(summary, /Recent mood:/);
  });

  it("never includes student message text in any alert, notification, or email payload", async () => {
    mockEnrollmentFindMany.mock.mockImplementation(async () => [
      enrollmentWithInstructors([
        { id: "instructor-1", email: "one@example.test", isActive: true },
      ]),
    ]);
    mockMoodFindFirst.mock.mockImplementation(async () => ({
      score: 2,
      extractedAt: new Date("2026-07-12T09:00:00.000Z"),
    }));

    await recordWellbeingConcern({
      studentId: "student-1",
      conversationId: "conv-1",
      reason: "message_signal",
      category: "self_harm",
      now: FIXED_NOW,
    });

    assert.ok(mockAlertUpsert.mock.callCount() > 0);
    assert.ok(mockSendNotification.mock.callCount() > 0);
    assert.ok(mockEnqueueJob.mock.callCount() > 0);

    const everyPayload = JSON.stringify({
      alerts: mockAlertUpsert.mock.calls.map((call: any) => call.arguments),
      notifications: mockSendNotification.mock.calls.map((call: any) => call.arguments),
      emails: mockEnqueueJob.mock.calls.map((call: any) => call.arguments),
    });
    assert.ok(
      !everyPayload.includes(RAW_STUDENT_MESSAGE),
      "raw student message must never appear in any payload",
    );
    assert.ok(
      !everyPayload.toLowerCase().includes("kill myself"),
      "no fragment of the student's message may appear in any payload",
    );
  });

  it("no longer directs staff to open the student's conversation anywhere", async () => {
    mockEnrollmentFindMany.mock.mockImplementation(async () => [
      enrollmentWithInstructors([
        { id: "instructor-1", email: "one@example.test", isActive: true },
      ]),
    ]);

    await recordWellbeingConcern({
      studentId: "student-1",
      conversationId: "conv-1",
      reason: "message_signal",
      category: "self_harm",
      now: FIXED_NOW,
    });

    const args = upsertArgs();
    for (const summary of [args.create.summary, args.update.summary]) {
      assert.doesNotMatch(summary, /open their conversation/i);
      assert.doesNotMatch(summary, /open the student's conversation/i);
      assert.match(summary, /review the crisis card and reach out to the student directly/);
    }

    const emailText = mockEnqueueJob.mock.calls[0].arguments[0].payload.text;
    assert.doesNotMatch(emailText, /open their conversation/i);
    assert.doesNotMatch(emailText, /open the student's conversation/i);
    assert.match(emailText, /review the crisis card in VisionQuest and reach out to the student directly/);
    assert.match(emailText, /Recommended response:/);
    assert.match(emailText, /call 911/);
    assert.match(emailText, /988/);
  });
});
