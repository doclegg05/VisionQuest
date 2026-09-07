/* eslint-disable @typescript-eslint/no-explicit-any -- mock scaffolding stands in for archiver, db, and storage. */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";

/**
 * Ticket D5b — bounded relations with a truncation manifest.
 *
 * The archive's `findUnique` selects several relations with no `take:`
 * anywhere, and builds one ZIP in memory. This file proves two things at the
 * RUNTIME level (the query-level `take`/`orderBy` is not exercised by this
 * mock, which hands back whatever fixture array is set regardless of the
 * Prisma args passed to it — see the module comment in
 * student-archive.export-completeness.test.ts for why that split exists):
 *
 *  1. A relation at or under its cap produces no `manifest.truncated` entry,
 *     and every row is kept, in oldest-first order (this file's convention).
 *  2. A relation OVER its cap produces exactly one `manifest.truncated`
 *     entry naming the model, keeps only the newest `cap` rows (by
 *     timestamp — not by array position, since the mock does not pre-sort),
 *     and still emits them oldest-first.
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

function manifestOf(): any {
  const entry = appended.find((a) => a.name === "manifest.json");
  assert.ok(entry, "the bundle must contain manifest.json");
  return JSON.parse(String(entry!.content));
}

function truncationFor(model: string): { model: string; kept: number; cap: number } | undefined {
  return manifestOf().truncated.find((t: { model: string }) => t.model === model);
}

/** N notification rows, newest last (this fixture's own bookkeeping only —
 * the code under test must not rely on fixture order, since the mock does
 * not apply Prisma's `orderBy`). */
function notificationRows(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    type: "goal_confirmed",
    title: `Notification ${i}`,
    body: `Body ${i}`,
    createdAt: new Date(2026, 0, 1 + i),
  }));
}

function baseRow(overrides: Record<string, unknown> = {}) {
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
    ...overrides,
  };
}

describe("generateStudentArchive — bounded relations with a truncation manifest (ticket D5b)", () => {
  beforeEach(() => {
    appended.length = 0;
    mockStudentFindUnique.mock.resetCalls();
  });

  it("under the cap: keeps every row, oldest-first, and writes no truncation entry", async () => {
    const rows = notificationRows(3);
    mockStudentFindUnique.mock.mockImplementation(async () => baseRow({ notifications: rows }));

    await generateStudentArchive("stu-1", "tch-1");

    const notifications = jsonOf("notifications.json") as any[];
    assert.deepEqual(
      notifications.map((n) => n.title),
      ["Notification 0", "Notification 1", "Notification 2"],
    );
    assert.equal(truncationFor("Notification"), undefined);
  });

  it("over the cap: keeps only the newest 5,000 Notification rows and records the manifest entry", async () => {
    const CAP = 5_000;
    // Deliberately shuffled relative to createdAt, so the test cannot pass by
    // accident of array-position slicing — the code must sort by timestamp.
    const rows = notificationRows(CAP + 1);
    const shuffled = [rows[rows.length - 1], ...rows.slice(0, rows.length - 1)];
    mockStudentFindUnique.mock.mockImplementation(async () => baseRow({ notifications: shuffled }));

    await generateStudentArchive("stu-1", "tch-1");

    const notifications = jsonOf("notifications.json") as any[];
    assert.equal(notifications.length, CAP);
    // The oldest row (index 0) must have been dropped; the newest (index CAP)
    // must be present and last (oldest-first order).
    assert.ok(!notifications.some((n) => n.title === "Notification 0"));
    assert.equal(notifications[notifications.length - 1].title, `Notification ${CAP}`);
    // Still oldest-first.
    for (let i = 1; i < notifications.length; i++) {
      assert.ok(new Date(notifications[i - 1].createdAt).getTime() <= new Date(notifications[i].createdAt).getTime());
    }

    assert.deepEqual(truncationFor("Notification"), { model: "Notification", kept: CAP, cap: CAP });
  });

  it("caps StudentAlert, MoodEntry, and FailedExtraction the same way (5,000)", async () => {
    const CAP = 5_000;
    const overCap = (n: number, field: string) =>
      Array.from({ length: n }, (_, i) => ({
        [field]: new Date(2026, 0, 1 + i),
        marker: i,
      }));

    mockStudentFindUnique.mock.mockImplementation(async () =>
      baseRow({
        alerts: overCap(CAP + 5, "detectedAt").map((r) => ({
          type: "missed_appointment",
          severity: "medium",
          status: "open",
          title: `Alert ${r.marker}`,
          summary: "s",
          detectedAt: r.detectedAt,
          resolvedAt: null,
        })),
        moodEntries: overCap(CAP + 5, "extractedAt").map((r) => ({
          score: 3,
          context: `Mood ${r.marker}`,
          source: "chat",
          conversationId: null,
          extractedAt: r.extractedAt,
        })),
        failedExtractions: overCap(CAP + 5, "createdAt").map((r) => ({
          extractorKey: "goal_extraction",
          payload: `Payload ${r.marker}`,
          error: "e",
          status: "open",
          createdAt: r.createdAt,
        })),
      }),
    );

    await generateStudentArchive("stu-1", "tch-1");

    assert.equal((jsonOf("alerts.json") as any[]).length, CAP);
    assert.equal((jsonOf("mood-entries.json") as any[]).length, CAP);
    assert.equal((jsonOf("failed-extractions.json") as any[]).length, CAP);

    assert.deepEqual(truncationFor("StudentAlert"), { model: "StudentAlert", kept: CAP, cap: CAP });
    assert.deepEqual(truncationFor("MoodEntry"), { model: "MoodEntry", kept: CAP, cap: CAP });
    assert.deepEqual(truncationFor("FailedExtraction"), {
      model: "FailedExtraction",
      kept: CAP,
      cap: CAP,
    });
  });

  it("caps one conversation's messages at 20,000 without affecting another conversation", async () => {
    const CAP = 20_000;
    const bigMessages = Array.from({ length: CAP + 2 }, (_, i) => ({
      role: i % 2 === 0 ? "student" : "sage",
      content: `msg-${i}`,
      createdAt: new Date(2026, 0, 1, 0, 0, i),
    }));

    mockStudentFindUnique.mock.mockImplementation(async () =>
      baseRow({
        conversations: [
          {
            id: "conv-big",
            module: "career",
            stage: "explore",
            title: "Big",
            summary: null,
            active: true,
            createdAt: new Date("2026-01-01T00:00:00.000Z"),
            updatedAt: new Date("2026-01-01T00:00:00.000Z"),
            messages: bigMessages,
          },
          {
            id: "conv-small",
            module: "career",
            stage: "explore",
            title: "Small",
            summary: null,
            active: true,
            createdAt: new Date("2026-01-02T00:00:00.000Z"),
            updatedAt: new Date("2026-01-02T00:00:00.000Z"),
            messages: [
              { role: "student", content: "hi", createdAt: new Date("2026-01-02T00:00:01.000Z") },
            ],
          },
        ],
      }),
    );

    await generateStudentArchive("stu-1", "tch-1");

    const conversations = jsonOf("sage/conversations.json") as any[];
    const big = conversations.find((c) => c.id === "conv-big");
    const small = conversations.find((c) => c.id === "conv-small");
    assert.equal(big.messages.length, CAP);
    assert.equal(small.messages.length, 1);
    // The oldest two messages (msg-0, msg-1) must have been dropped.
    assert.ok(!big.messages.some((m: any) => m.content === "msg-0"));
    assert.ok(!big.messages.some((m: any) => m.content === "msg-1"));
    assert.equal(big.messages[big.messages.length - 1].content, `msg-${CAP + 1}`);

    assert.deepEqual(truncationFor("Message"), { model: "Message", kept: CAP, cap: CAP });
  });

  it("caps one connection's events at 5,000 without needing a parentId in the manifest", async () => {
    const CAP = 5_000;
    const events = Array.from({ length: CAP + 3 }, (_, i) => ({
      fromStatus: "sent",
      toStatus: "viewed",
      actorType: "system",
      note: `event-${i}`,
      at: new Date(2026, 0, 1, 0, 0, i),
    }));

    mockStudentFindUnique.mock.mockImplementation(async () =>
      baseRow({
        connections: [
          {
            status: "hired",
            statusChangedAt: new Date("2026-01-05T00:00:00.000Z"),
            proposedVia: "instructor",
            packet: { includedFields: ["name"] },
            sentAt: new Date("2026-01-01T00:00:00.000Z"),
            employerViewedAt: null,
            employerRespondedAt: null,
            employerResponse: null,
            responseReason: null,
            hiredAt: null,
            startDate: null,
            hourlyWage: null,
            closedReason: null,
            createdAt: new Date("2026-01-01T00:00:00.000Z"),
            employer: { name: "Acme" },
            jobLead: { title: "Warehouse" },
            events,
          },
        ],
      }),
    );

    await generateStudentArchive("stu-1", "tch-1");

    const disclosures = jsonOf("connections.json") as any[];
    assert.equal(disclosures[0].events.length, CAP);
    assert.ok(!disclosures[0].events.some((e: any) => e.note === "event-0"));
    assert.equal(disclosures[0].events[disclosures[0].events.length - 1].note, `event-${CAP + 2}`);

    assert.deepEqual(truncationFor("ConnectionEvent"), { model: "ConnectionEvent", kept: CAP, cap: CAP });
  });

  it("a manifest with no truncated relation has an empty truncated array (a capped export is complete for a student under every cap)", async () => {
    mockStudentFindUnique.mock.mockImplementation(async () => baseRow());

    await generateStudentArchive("stu-1", "tch-1");

    assert.deepEqual(manifestOf().truncated, []);
  });
});
