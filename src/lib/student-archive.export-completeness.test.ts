/* eslint-disable @typescript-eslint/no-explicit-any -- mock scaffolding stands in for archiver, db, and storage. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { before, beforeEach, describe, it, mock } from "node:test";

/**
 * Ticket D5 — the offboarding export must cover every student-linked model
 * that carries something the student wrote, said, chose, or was told.
 *
 * config/benchmarks/offboarding-completeness.json measures this over the
 * SOURCE TEXT of student-archive.ts (does the select literally name each
 * Student relation field?). This file measures the other half: given real
 * data in each of those fields, does the RUNTIME output actually carry it,
 * under a stable key, with the student's own words intact?
 */

const appended: Array<{ name: string; content: unknown }> = [];

let piped: { end: () => void } | null = null;
const archiveStub = {
  pipe: (destination: { end: () => void }) => {
    piped = destination;
  },
  append: (content: unknown, options: { name: string }) => {
    appended.push({ name: options.name, content });
  },
  finalize: async () => {
    piped?.end();
  },
  on: () => undefined,
};

mock.module("archiver", { defaultExport: () => archiveStub });

const mockStudentFindUnique = mock.fn(async () => null as any) as any;

mock.module("./db", {
  namedExports: {
    prisma: {
      student: {
        get findUnique() {
          return mockStudentFindUnique;
        },
        update: mock.fn(async () => ({})),
      },
    },
  },
});

mock.module("./storage", {
  namedExports: {
    downloadFile: async () => null,
    uploadFile: async () => "archives/stu-1.zip",
  },
});

let generateStudentArchive: typeof import("./student-archive").generateStudentArchive;

before(async () => {
  ({ generateStudentArchive } = await import("./student-archive"));
});

function jsonOf(name: string): unknown {
  const entry = appended.find((a) => a.name === name);
  assert.ok(entry, `expected an archive entry named "${name}"`);
  return JSON.parse(String(entry!.content));
}

function manifestPaths(): string[] {
  const manifest = appended.find((a) => a.name === "manifest.json");
  assert.ok(manifest, "the bundle must contain manifest.json");
  return (JSON.parse(String(manifest!.content)).entries as Array<{ path: string }>).map(
    (e) => e.path,
  );
}

/**
 * A student row carrying real data in every model this ticket adds. Fields
 * not exercised by a given test are left at their empty/absent default via
 * the base fixture below (`emptyStudentRow`) and overridden here per test —
 * this function is the "everything present" case used by the "every
 * included model appears" test.
 */
function fullStudentRow() {
  return {
    id: "stu-1",
    studentId: "VQ-0001",
    displayName: "Test Student",
    formSubmissions: [],
    files: [],
    certifications: [],
    portfolioItems: [],
    resumeData: null,
    workProfile: null,
    connections: [],

    conversations: [
      {
        id: "conv-1",
        module: "career",
        stage: "explore",
        title: "Career chat",
        summary: "Discussed pathways.",
        active: true,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-02T00:00:00.000Z"),
        messages: [
          {
            role: "student",
            content: "My name is Jordan and I want to talk about my friend Casey.",
            createdAt: new Date("2026-01-01T00:00:01.000Z"),
          },
          {
            role: "sage",
            content: "Tell me more about what Casey is planning.",
            createdAt: new Date("2026-01-01T00:00:02.000Z"),
          },
        ],
      },
    ],
    sageInsights: [
      {
        category: "strength",
        content: "Shows up consistently for morning sessions.",
        confidence: 0.8,
        status: "active",
        createdAt: new Date("2026-01-03T00:00:00.000Z"),
      },
    ],
    sagePanels: [
      {
        panelDate: new Date("2026-01-04T00:00:00.000Z"),
        spec: { widgets: ["xp"] },
        status: "ready",
        createdAt: new Date("2026-01-04T00:00:00.000Z"),
      },
    ],
    goals: [
      {
        id: "goal-1",
        level: "long_term",
        parentId: null,
        content: "Get my CDL.",
        status: "active",
        confirmedAt: new Date("2026-01-05T00:00:00.000Z"),
        lastReviewedAt: null,
        createdAt: new Date("2026-01-05T00:00:00.000Z"),
        updatedAt: new Date("2026-01-05T00:00:00.000Z"),
      },
    ],
    goalResourceLinks: [
      {
        goalId: "goal-1",
        resourceType: "certification",
        title: "CDL Prep Course",
        description: null,
        url: null,
        linkType: "assigned",
        status: "assigned",
        dueAt: null,
        createdAt: new Date("2026-01-05T00:00:00.000Z"),
      },
    ],
    careerDiscovery: {
      status: "complete",
      interests: "Driving, logistics",
      strengths: null,
      subjects: null,
      problems: null,
      values: null,
      circumstances: null,
      topClusters: ["transportation"],
      sageSummary: "Interested in transportation.",
      riasecScores: null,
      hollandCode: null,
      nationalClusters: null,
      transferableSkills: null,
      workValues: null,
      assessmentSummary: null,
      profileSource: "sage_inferred",
      assessedAt: null,
      assessmentPayload: null,
      completedAt: new Date("2026-01-06T00:00:00.000Z"),
      createdAt: new Date("2026-01-06T00:00:00.000Z"),
      updatedAt: new Date("2026-01-06T00:00:00.000Z"),
    },
    careerCampaigns: [
      {
        status: "active",
        targetClusters: ["transportation"],
        currentStage: "prep",
        weeklyApplicationTarget: 3,
        createdAt: new Date("2026-01-07T00:00:00.000Z"),
        updatedAt: new Date("2026-01-07T00:00:00.000Z"),
      },
    ],
    coachingArcs: [
      {
        arcType: "standard_6week",
        weekNumber: 2,
        milestones: [],
        status: "active",
        startedAt: new Date("2026-01-08T00:00:00.000Z"),
        createdAt: new Date("2026-01-08T00:00:00.000Z"),
        updatedAt: new Date("2026-01-08T00:00:00.000Z"),
      },
    ],
    visionBoardItems: [
      {
        type: "text",
        content: "Own my own truck someday.",
        fileId: null,
        goalId: "goal-1",
        createdAt: new Date("2026-01-09T00:00:00.000Z"),
      },
    ],
    moodEntries: [
      {
        score: 4,
        context: "Feeling good about the CDL class.",
        source: "chat",
        conversationId: "conv-1",
        extractedAt: new Date("2026-01-10T00:00:00.000Z"),
      },
    ],
    resumeVersions: [
      {
        jobListingId: null,
        jobLeadId: null,
        version: 1,
        content: { summary: "Reliable and hardworking." },
        status: "draft",
        createdAt: new Date("2026-01-11T00:00:00.000Z"),
      },
    ],
    coverLetters: [
      {
        jobListingId: null,
        jobLeadId: null,
        version: 1,
        content: "Dear hiring manager, ...",
        status: "draft",
        createdAt: new Date("2026-01-12T00:00:00.000Z"),
      },
    ],
    applications: [
      {
        status: "applied",
        notes: "Called to follow up.",
        appliedAt: new Date("2026-01-13T00:00:00.000Z"),
        verificationStatus: "self_reported",
        verifiedAt: null,
        createdAt: new Date("2026-01-13T00:00:00.000Z"),
        opportunity: { title: "Warehouse Associate", company: "Acme Logistics" },
      },
    ],
    savedJobs: [
      {
        status: "saved",
        notes: null,
        savedAt: new Date("2026-01-14T00:00:00.000Z"),
        appliedAt: null,
        jobListing: { title: "Forklift Operator", company: "Beta Freight" },
      },
    ],
    wagers: [
      {
        wagerType: "cert_completion",
        hypothesis: "I will finish my CDL by March.",
        predictedOutcome: "complete",
        confidence: 0.7,
        horizonAt: new Date("2026-03-01T00:00:00.000Z"),
        status: "open",
        createdAt: new Date("2026-01-15T00:00:00.000Z"),
      },
    ],
    assignedTasks: [
      {
        title: "Upload resume",
        description: "Add your latest resume to the portfolio.",
        dueAt: new Date("2026-01-20T00:00:00.000Z"),
        status: "open",
        priority: "normal",
        completedAt: null,
        createdAt: new Date("2026-01-16T00:00:00.000Z"),
        createdBy: { displayName: "Ms. Rivera" },
      },
    ],
    appointments: [
      {
        title: "Advising check-in",
        description: null,
        startsAt: new Date("2026-01-17T09:00:00.000Z"),
        endsAt: new Date("2026-01-17T09:30:00.000Z"),
        status: "scheduled",
        locationType: "virtual",
        locationLabel: null,
        notes: "Discuss CDL timeline.",
        createdAt: new Date("2026-01-16T00:00:00.000Z"),
        advisor: { displayName: "Ms. Rivera" },
      },
    ],
    eventRegistrations: [
      {
        status: "registered",
        registeredAt: new Date("2026-01-18T00:00:00.000Z"),
        event: { title: "Hiring Fair", startsAt: new Date("2026-02-01T00:00:00.000Z") },
      },
    ],
    orientationProgress: [
      {
        completed: true,
        completedAt: new Date("2026-01-01T00:00:00.000Z"),
        verificationStatus: "verified",
        verifiedAt: new Date("2026-01-02T00:00:00.000Z"),
        item: { label: "Watch the welcome video" },
      },
    ],
    formResponses: [
      {
        answers: { q1: "yes" },
        status: "submitted",
        submittedAt: new Date("2026-01-19T00:00:00.000Z"),
        reviewedAt: null,
        createdAt: new Date("2026-01-19T00:00:00.000Z"),
        template: { title: "Intake Survey" },
      },
    ],
    consentRecords: [
      {
        scope: "employer_referral",
        grantedAt: new Date("2026-01-20T00:00:00.000Z"),
        revokedAt: null,
        createdAt: new Date("2026-01-20T00:00:00.000Z"),
      },
    ],
    spokesRecord: {
      firstName: "Jordan",
      lastName: "Smith",
      county: "Kanawha",
      householdType: "single",
      requiredParticipationHours: 20,
      referralDate: new Date("2025-12-01T00:00:00.000Z"),
      status: "enrolled",
      enrolledAt: new Date("2025-12-05T00:00:00.000Z"),
      exitDate: null,
      barriersOnEntry: ["transportation"],
      barriersRemaining: [],
      educationalLevel: "hs_diploma",
      tabeDate: null,
      postSecondaryProgram: null,
      unsubsidizedEmploymentAt: null,
      employerName: null,
      hourlyWage: null,
      nonCompleterAt: null,
      nonCompleterReason: null,
      notes: "Doing well.",
      createdAt: new Date("2025-12-01T00:00:00.000Z"),
    },
    classEnrollments: [
      {
        status: "active",
        enrolledAt: new Date("2025-12-05T00:00:00.000Z"),
        archivedAt: null,
        archiveReason: null,
        class: { name: "SPOKES Cohort 4" },
      },
    ],
    publicCredentialPage: {
      slug: "jordan-s",
      headline: "Future CDL driver",
      summary: "Working toward my commercial license.",
      isPublic: true,
      createdAt: new Date("2026-01-21T00:00:00.000Z"),
    },
    notificationPreferences: [
      {
        channel: "email",
        enabled: true,
        destination: null,
        smsConsentAt: null,
        smsRevokedAt: null,
        createdAt: new Date("2026-01-22T00:00:00.000Z"),
      },
    ],
    notifications: [
      {
        type: "goal_confirmed",
        title: "Your goal was confirmed",
        body: "Ms. Rivera confirmed your CDL goal.",
        createdAt: new Date("2026-01-23T00:00:00.000Z"),
      },
    ],
    caseNotes: [
      {
        category: "risk",
        body: "Student mentioned housing instability; referred to case manager.",
        createdAt: new Date("2026-01-24T00:00:00.000Z"),
        author: { displayName: "Ms. Rivera" },
      },
    ],
    alerts: [
      {
        type: "missed_appointment",
        severity: "medium",
        status: "open",
        title: "Missed check-in",
        summary: "Student missed the 1/17 advising appointment.",
        detectedAt: new Date("2026-01-25T00:00:00.000Z"),
        resolvedAt: null,
      },
    ],
    failedExtractions: [
      {
        extractorKey: "goal_extraction",
        payload: "I want to get my CDL by summer.",
        error: "model returned invalid JSON",
        status: "open",
        createdAt: new Date("2026-01-26T00:00:00.000Z"),
      },
    ],
  };
}

/** Every new field present but empty/absent — the "student has none of this" case. */
function emptyStudentRow() {
  return {
    id: "stu-1",
    studentId: "VQ-0001",
    displayName: "Test Student",
    formSubmissions: [],
    files: [],
    certifications: [],
    portfolioItems: [],
    resumeData: null,
    workProfile: null,
    connections: [],
    conversations: [],
    sageInsights: [],
    sagePanels: [],
    goals: [],
    goalResourceLinks: [],
    careerDiscovery: null,
    careerCampaigns: [],
    coachingArcs: [],
    visionBoardItems: [],
    moodEntries: [],
    resumeVersions: [],
    coverLetters: [],
    applications: [],
    savedJobs: [],
    wagers: [],
    assignedTasks: [],
    appointments: [],
    eventRegistrations: [],
    orientationProgress: [],
    formResponses: [],
    consentRecords: [],
    spokesRecord: null,
    classEnrollments: [],
    publicCredentialPage: null,
    notificationPreferences: [],
    notifications: [],
    caseNotes: [],
    alerts: [],
    failedExtractions: [],
  };
}

describe("generateStudentArchive — export completeness (ticket D5)", () => {
  beforeEach(() => {
    appended.length = 0;
    mockStudentFindUnique.mock.resetCalls();
  });

  it("writes every newly-covered model to its own stable-key section when present", async () => {
    mockStudentFindUnique.mock.mockImplementation(async () => fullStudentRow());

    await generateStudentArchive("stu-1", "tch-1");

    const expectedSections: Array<[path: string, assertions: (data: any) => void]> = [
      [
        "sage/conversations.json",
        (data) => {
          assert.equal(data.length, 1);
          assert.equal(data[0].messages.length, 2);
        },
      ],
      ["sage/insights.json", (data) => assert.equal(data.length, 1)],
      ["sage/panels.json", (data) => assert.equal(data.length, 1)],
      [
        "goals.json",
        (data) => {
          assert.equal(data.length, 1);
          assert.equal(data[0].resourceLinks.length, 1);
          assert.equal(data[0].resourceLinks[0].title, "CDL Prep Course");
        },
      ],
      ["career/discovery.json", (data) => assert.equal(data.status, "complete")],
      ["career/campaigns.json", (data) => assert.equal(data.length, 1)],
      ["career/coaching-arcs.json", (data) => assert.equal(data.length, 1)],
      ["vision-board.json", (data) => assert.equal(data.length, 1)],
      ["mood-entries.json", (data) => assert.equal(data.length, 1)],
      ["resume/resume-versions.json", (data) => assert.equal(data.length, 1)],
      ["cover-letters.json", (data) => assert.equal(data.length, 1)],
      ["applications.json", (data) => assert.equal(data[0].opportunity.title, "Warehouse Associate")],
      ["saved-jobs.json", (data) => assert.equal(data.length, 1)],
      ["wagers.json", (data) => assert.equal(data.length, 1)],
      ["tasks.json", (data) => assert.equal(data.length, 1)],
      ["appointments.json", (data) => assert.equal(data.length, 1)],
      ["event-registrations.json", (data) => assert.equal(data.length, 1)],
      ["orientation-progress.json", (data) => assert.equal(data.length, 1)],
      ["form-responses.json", (data) => assert.equal(data.length, 1)],
      ["consent-records.json", (data) => assert.equal(data.length, 1)],
      ["spokes-record.json", (data) => assert.equal(data.firstName, "Jordan")],
      ["class-enrollments.json", (data) => assert.equal(data.length, 1)],
      ["credential-page.json", (data) => assert.equal(data.slug, "jordan-s")],
      ["notification-preferences.json", (data) => assert.equal(data.length, 1)],
      ["notifications.json", (data) => assert.equal(data.length, 1)],
      ["case-notes.json", (data) => assert.equal(data.length, 1)],
      ["alerts.json", (data) => assert.equal(data.length, 1)],
      ["failed-extractions.json", (data) => assert.equal(data.length, 1)],
    ];

    const paths = manifestPaths();
    for (const [entryPath, assertData] of expectedSections) {
      assert.ok(paths.includes(entryPath), `manifest.json must list ${entryPath}`);
      assertData(jsonOf(entryPath));
    }
  });

  it("writes no section for a model list/relation that is empty or absent", async () => {
    mockStudentFindUnique.mock.mockImplementation(async () => emptyStudentRow());

    await generateStudentArchive("stu-1", "tch-1");

    const neverWritten = [
      "sage/conversations.json",
      "sage/insights.json",
      "sage/panels.json",
      "goals.json",
      "career/discovery.json",
      "career/campaigns.json",
      "career/coaching-arcs.json",
      "vision-board.json",
      "mood-entries.json",
      "resume/resume-versions.json",
      "cover-letters.json",
      "applications.json",
      "saved-jobs.json",
      "wagers.json",
      "tasks.json",
      "appointments.json",
      "event-registrations.json",
      "orientation-progress.json",
      "form-responses.json",
      "consent-records.json",
      "spokes-record.json",
      "class-enrollments.json",
      "credential-page.json",
      "notification-preferences.json",
      "notifications.json",
      "case-notes.json",
      "alerts.json",
      "failed-extractions.json",
    ];

    for (const name of neverWritten) {
      assert.equal(
        appended.some((a) => a.name === name),
        false,
        `an empty ${name} would imply a record that does not exist`,
      );
    }
  });

  it("exports a Message's content verbatim, even when it names another student", async () => {
    // The archive is the STUDENT'S OWN record — this file is where they said
    // it, to Sage, in their own conversation. De-identification is a cloud-AI
    // egress concern (src/lib/ai/**, explicitly out of this ticket's file
    // fence) and is never applied to a student's own copy of their own words.
    mockStudentFindUnique.mock.mockImplementation(async () => ({
      ...emptyStudentRow(),
      conversations: [
        {
          id: "conv-1",
          module: "career",
          stage: "explore",
          title: null,
          summary: null,
          active: true,
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
          updatedAt: new Date("2026-01-01T00:00:00.000Z"),
          messages: [
            {
              role: "student",
              content: "My friend Alex Rivera also goes here and we study together.",
              createdAt: new Date("2026-01-01T00:00:01.000Z"),
            },
          ],
        },
      ],
    }));

    await generateStudentArchive("stu-1", "tch-1");

    const conversations = jsonOf("sage/conversations.json") as any[];
    assert.equal(
      conversations[0].messages[0].content,
      "My friend Alex Rivera also goes here and we study together.",
    );
  });

  it("orders conversations and their messages oldest-first", async () => {
    mockStudentFindUnique.mock.mockImplementation(async () => ({
      ...emptyStudentRow(),
      conversations: [
        {
          id: "conv-older",
          module: "career",
          stage: "explore",
          title: null,
          summary: null,
          active: true,
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
          updatedAt: new Date("2026-01-01T00:00:00.000Z"),
          messages: [
            { role: "student", content: "first", createdAt: new Date("2026-01-01T00:00:01.000Z") },
            { role: "sage", content: "second", createdAt: new Date("2026-01-01T00:00:02.000Z") },
          ],
        },
      ],
    }));

    await generateStudentArchive("stu-1", "tch-1");

    const conversations = jsonOf("sage/conversations.json") as any[];
    assert.deepEqual(
      conversations[0].messages.map((m: any) => m.content),
      ["first", "second"],
    );
  });

  it("includes every CaseNote category verbatim, including 'risk'", async () => {
    // See the select block's comment in student-archive.ts: no CaseNote
    // category is documented as staff-confidential in the schema,
    // docs/DATA_RETENTION_POLICY.md, or .claude/rules/security.md today, so
    // none is redacted here.
    mockStudentFindUnique.mock.mockImplementation(async () => ({
      ...emptyStudentRow(),
      caseNotes: [
        {
          category: "risk",
          body: "Housing instability discussed; case manager notified.",
          createdAt: new Date("2026-01-24T00:00:00.000Z"),
          author: { displayName: "Ms. Rivera" },
        },
      ],
    }));

    await generateStudentArchive("stu-1", "tch-1");

    const notes = jsonOf("case-notes.json") as any[];
    assert.equal(notes.length, 1);
    assert.equal(notes[0].category, "risk");
    assert.match(notes[0].body, /Housing instability/);
  });

  it("still exports the rest of a NotificationPreference row when it has SMS consent fields", async () => {
    mockStudentFindUnique.mock.mockImplementation(async () => ({
      ...emptyStudentRow(),
      notificationPreferences: [
        {
          channel: "sms",
          enabled: true,
          destination: "555-0100",
          smsConsentAt: new Date("2026-01-01T00:00:00.000Z"),
          smsRevokedAt: null,
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
        },
      ],
    }));

    await generateStudentArchive("stu-1", "tch-1");

    const prefs = jsonOf("notification-preferences.json") as any[];
    assert.equal(prefs.length, 1);
    assert.equal(prefs[0].channel, "sms");
    assert.ok(prefs[0].smsConsentAt);
  });
});

describe("student-archive.ts — the NotificationPreference select never names the verification-code fields", () => {
  it("does not select smsVerifyCodeHash or smsVerifyExpiresAt", () => {
    // Unlike the mock-based tests above (which only prove what the code does
    // with whatever Prisma hands it), Prisma only ever returns the columns a
    // `select` names — so the guarantee that an authentication artifact never
    // reaches the export lives in the SELECT clause itself. This checks for
    // the field as a select KEY (`fieldName:`), not for the name anywhere in
    // the file, so the explanatory comment naming why it's excluded doesn't
    // trip the same check it documents.
    const source = readFileSync(join(process.cwd(), "src/lib/student-archive.ts"), "utf8");
    assert.doesNotMatch(source, /\bsmsVerifyCodeHash\s*:/);
    assert.doesNotMatch(source, /\bsmsVerifyExpiresAt\s*:/);
  });
});

describe("archive-exemptions fixture — only the original 5 non-personal/derivable models", () => {
  it("lists exactly the models this suite has always exempted, and nothing this ticket added", () => {
    const fixturePath = join(
      process.cwd(),
      "config/benchmarks/fixtures/archive-exemptions.json",
    );
    const raw = JSON.parse(readFileSync(fixturePath, "utf8"));
    const exemptedModels = Object.keys(raw).filter((key) => !key.startsWith("_"));

    assert.deepEqual(
      exemptedModels.sort(),
      [
        "LlmCallLog",
        "PasswordResetToken",
        "Progression",
        "ProgressionEvent",
        "SecurityQuestionAnswer",
      ].sort(),
      "the fixture must exempt only non-personal/derivable bookkeeping models — " +
        "every model this ticket added coverage for must be a real export, not a new exemption",
    );
  });
});
