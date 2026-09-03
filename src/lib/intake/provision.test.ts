/**
 * `provisionIntakeStudent` is reached from two doors with very different
 * trust: a staff-authenticated webhook, and a public form anyone on the
 * internet can post. These cases pin the differences the 2026-09-03 review
 * found missing — an anonymous caller must not be handed an existing account
 * (B1), must not be handed a credential (B2), must not overwrite a record
 * (M17), and self-attested consent is not staff verification (M6).
 */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";

mock.module("@/lib/auth", {
  namedExports: {
    hashPassword: (password: string) => ({ hash: `hashed:${password}`, salt: "salt" }),
    normalizeEmail: (raw: string) => raw.trim().toLowerCase(),
    normalizeStudentId: (raw: string) => raw.trim().toLowerCase(),
  },
});

mock.module("@/lib/logger", {
  namedExports: {
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
  },
});

const tryLogAuditEventMock = mock.fn(async () => ({ audited: true }));
mock.module("@/lib/audit", { namedExports: { tryLogAuditEvent: tryLogAuditEventMock } });

mock.module("@/lib/intake/pdf-stamped-packet", {
  namedExports: { saveStampedIntakePacket: mock.fn(async () => ({ storageKey: "packet.pdf" })) },
});

const EXISTING = { id: "stu_existing", studentId: "dana.hall", displayName: "Dana Hall" };

const state = {
  spokesMatch: null as typeof EXISTING | null,
  classes: [] as Array<{ id: string; name: string; description: string | null }>,
  countyFilter: null as string | null,
};

const created = {
  students: [] as Array<Record<string, unknown>>,
  progress: [] as Array<Record<string, unknown>>,
  alerts: [] as Array<Record<string, unknown>>,
  enrollments: [] as Array<Record<string, unknown>>,
  spokesUpserts: [] as Array<Record<string, unknown>>,
};

const fakeClient = {
  student: {
    findFirst: async () => null,
    findUnique: async () => null,
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const row = { id: `stu_new_${created.students.length}`, ...data };
      created.students.push(row);
      return row;
    },
  },
  spokesRecord: {
    findFirst: async () => (state.spokesMatch ? { student: state.spokesMatch } : null),
    upsert: async (args: Record<string, unknown>) => {
      created.spokesUpserts.push(args);
      return { id: "spokes_existing" };
    },
    create: async ({ data }: { data: Record<string, unknown> }) => ({ id: "spokes_new", ...data }),
  },
  spokesClass: {
    findFirst: async (args: { where?: Record<string, unknown> }) => {
      const where = args?.where ?? {};
      if (typeof where.id === "string") {
        return state.classes.find((c) => c.id === where.id) ?? null;
      }
      if (state.countyFilter) {
        const needle = state.countyFilter.toLowerCase();
        return (
          state.classes.find((c) =>
            `${c.name} ${c.description ?? ""}`.toLowerCase().includes(needle),
          ) ?? null
        );
      }
      return state.classes[0] ?? null;
    },
  },
  studentClassEnrollment: {
    findUnique: async () => null,
    create: async ({ data }: { data: Record<string, unknown> }) => {
      created.enrollments.push(data);
      return data;
    },
  },
  studentAlert: {
    upsert: async (args: { create: Record<string, unknown> }) => {
      created.alerts.push(args.create);
      return args.create;
    },
  },
  orientationItem: {
    findMany: async () => [
      { id: "item_ferpa", label: "FERPA consent form", description: "Release of information" },
      { id: "item_policy", label: "Program policy agreement", description: null },
      { id: "item_video", label: "Watch the welcome video", description: null },
    ],
  },
  orientationProgress: {
    createMany: async ({ data }: { data: Array<Record<string, unknown>> }) => {
      created.progress.push(...data);
      return { count: data.length };
    },
  },
  $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(fakeClient),
};

mock.module("@/lib/db", {
  namedExports: { prisma: fakeClient, prismaAdmin: fakeClient },
});

let provision: typeof import("./provision");

before(async () => {
  provision = await import("./provision");
});

const PAYLOAD = {
  firstName: "Dana",
  lastName: "Hall",
  birthDate: "1988-02-03",
  county: "Kanawha",
  tanfStatus: false,
  ferpaConsentSigned: true,
  policyAcknowledgmentSigned: true,
  legalAffirmationSigned: true,
} as unknown as import("./schema").IntakePayload;

function reset() {
  state.spokesMatch = null;
  state.classes = [
    { id: "class_kanawha", name: "Kanawha County SPOKES", description: null },
    { id: "class_mercer", name: "Mercer County SPOKES", description: null },
  ];
  state.countyFilter = "Kanawha";
  created.students.length = 0;
  created.progress.length = 0;
  created.alerts.length = 0;
  created.enrollments.length = 0;
  created.spokesUpserts.length = 0;
  tryLogAuditEventMock.mock.resetCalls();
}

describe("provisionIntakeStudent — an existing match on the public path", () => {
  beforeEach(reset);

  it("returns no identity for the matched account", async () => {
    state.spokesMatch = EXISTING;

    const result = await provision.provisionIntakeStudent(PAYLOAD, { source: "public" });

    assert.equal(result.outcome, "duplicate_pending_review");
    const raw = JSON.stringify(result);
    assert.ok(!raw.includes(EXISTING.id), `result leaked the matched account id: ${raw}`);
    assert.ok(!raw.includes(EXISTING.studentId), `result leaked the matched username: ${raw}`);
    assert.ok(!raw.includes(EXISTING.displayName), `result leaked the matched name: ${raw}`);
  });

  it("writes nothing to the matched student's record", async () => {
    state.spokesMatch = EXISTING;

    await provision.provisionIntakeStudent(
      { ...PAYLOAD, county: "Mercer", notes: "attacker note" },
      { source: "public" },
    );

    assert.equal(created.spokesUpserts.length, 0);
    assert.equal(created.enrollments.length, 0);
    assert.equal(created.students.length, 0);
  });

  it("raises one staff-only alert on the matched student, keyed so repeats do not pile up", async () => {
    state.spokesMatch = EXISTING;

    await provision.provisionIntakeStudent(PAYLOAD, { source: "public" });

    assert.equal(created.alerts.length, 1);
    assert.equal(created.alerts[0].studentId, EXISTING.id);
    assert.equal(created.alerts[0].type, "duplicate_intake_submission");
    assert.equal(created.alerts[0].alertKey, `intake-duplicate:${EXISTING.id}`);
  });
});

describe("provisionIntakeStudent — an existing match on the staff path", () => {
  beforeEach(reset);

  it("still updates the record and reports the account, because staff authenticated the request", async () => {
    state.spokesMatch = EXISTING;

    const result = await provision.provisionIntakeStudent(PAYLOAD, { source: "staff" });

    assert.equal(result.outcome, "updated");
    assert.equal(created.spokesUpserts.length, 1);
    assert.equal(created.alerts.length, 0);
  });
});

describe("provisionIntakeStudent — the temporary password", () => {
  beforeEach(reset);

  it("never uses the shared, guessable default", async () => {
    const result = await provision.provisionIntakeStudent(PAYLOAD, { source: "staff" });

    assert.equal(result.outcome, "provisioned");
    if (result.outcome !== "provisioned") return;
    assert.ok(result.temporaryPassword);
    assert.ok(
      !/^Spokes20\d\d!$/.test(result.temporaryPassword as string),
      `temporary password was the shared default: ${result.temporaryPassword}`,
    );
    assert.ok((result.temporaryPassword as string).length >= 12);
  });

  it("issues a different password for every account", async () => {
    const first = await provision.provisionIntakeStudent(PAYLOAD, { source: "staff" });
    const second = await provision.provisionIntakeStudent(PAYLOAD, { source: "staff" });

    assert.equal(first.outcome, "provisioned");
    assert.equal(second.outcome, "provisioned");
    if (first.outcome !== "provisioned" || second.outcome !== "provisioned") return;
    assert.notEqual(first.temporaryPassword, second.temporaryPassword);
  });

  it("mints no password at all on the public path, so there is none to print", async () => {
    const result = await provision.provisionIntakeStudent(PAYLOAD, { source: "public" });

    assert.equal(result.outcome, "provisioned");
    if (result.outcome !== "provisioned") return;
    assert.equal(result.temporaryPassword, null);
    assert.equal(created.students[0].passwordHash, null);
  });

  it("marks every intake-provisioned account for rotation", async () => {
    await provision.provisionIntakeStudent(PAYLOAD, { source: "staff" });

    assert.equal(created.students[0].mustChangePassword, true);
  });

  it("generates a collision-suffixed username without Math.random", async () => {
    const source = await import("node:fs/promises").then((fs) =>
      fs.readFile(new URL("./provision.ts", import.meta.url), "utf8"),
    );

    assert.ok(
      !source.includes("Math.random"),
      "username collision fallback must use a CSPRNG, not Math.random",
    );
  });
});

describe("provisionIntakeStudent — orientation items", () => {
  beforeEach(reset);

  it("does not mark consent items complete or verified from a self-attested checkbox", async () => {
    await provision.provisionIntakeStudent(PAYLOAD, { source: "public" });

    assert.equal(created.progress.length, 3);
    for (const row of created.progress) {
      assert.equal(row.completed, false, `item ${row.itemId} was auto-completed`);
      assert.notEqual(row.verificationStatus, "verified", `item ${row.itemId} was auto-verified`);
      assert.equal(row.verifiedAt, null);
      assert.equal(row.verifiedBy, null);
    }
  });

  it("records a signed consent as awaiting staff verification", async () => {
    await provision.provisionIntakeStudent(PAYLOAD, { source: "public" });

    const ferpa = created.progress.find((r) => r.itemId === "item_ferpa");
    const video = created.progress.find((r) => r.itemId === "item_video");
    assert.equal(ferpa?.verificationStatus, "pending");
    assert.equal(video?.verificationStatus, null);
  });
});

describe("provisionIntakeStudent — class resolution", () => {
  beforeEach(reset);

  it("leaves the student unenrolled when no class matches their county", async () => {
    state.classes = [{ id: "class_mercer", name: "Mercer County SPOKES", description: null }];

    const result = await provision.provisionIntakeStudent(PAYLOAD, { source: "public" });

    assert.equal(result.outcome, "provisioned");
    if (result.outcome !== "provisioned") return;
    assert.equal(result.classId, null, "an unmatched county must not fall back to any cohort");
    assert.equal(created.enrollments.length, 0);
  });

  it("ignores a caller-supplied classId on the public path", async () => {
    await provision.provisionIntakeStudent({ ...PAYLOAD, classId: "class_mercer" }, {
      source: "public",
    });

    assert.equal(created.enrollments[0]?.classId, "class_kanawha");
  });

  it("honors an explicit classId from the staff path", async () => {
    await provision.provisionIntakeStudent({ ...PAYLOAD, classId: "class_mercer" }, {
      source: "staff",
    });

    assert.equal(created.enrollments[0]?.classId, "class_mercer");
  });
});
