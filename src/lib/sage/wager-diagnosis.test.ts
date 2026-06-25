import assert from "node:assert/strict";
import { before, describe, it, mock } from "node:test";

const insightWrites: unknown[] = [];
const verdictUpdates: unknown[] = [];

let diagnoseWager: typeof import("./wager-diagnosis").diagnoseWager;

before(async () => {
  process.env.SAGE_WAGER_DIAGNOSIS_ENABLED = "true";

  const fakeAdmin = {
    wager: {
      findUnique: async () => ({
        id: "w1",
        studentId: "s1",
        hypothesis: "Student will confirm a daily goal within 14 days.",
        verdict: { id: "v1", result: "loss" },
      }),
    },
    sageInsight: {
      create: async (a: { data: unknown }) => {
        insightWrites.push(a.data);
        return { id: "ins-1" };
      },
    },
    wagerVerdict: {
      update: async (a: unknown) => {
        verdictUpdates.push(a);
        return {};
      },
    },
  };

  mock.module("@/lib/db", {
    namedExports: { prismaAdmin: fakeAdmin, prisma: fakeAdmin },
  });

  mock.module("@/lib/rls-context", {
    namedExports: {
      withRlsContext: (_ctx: unknown, fn: () => unknown) => fn(),
    },
  });

  mock.module("@/lib/sage/context-bundle", {
    namedExports: {
      assembleStudentContextBundle: async () => ({
        student: { id: "s1", displayName: "Test Student" },
        goals: { active: [] },
      }),
    },
  });

  mock.module("@/lib/ai/provider", {
    namedExports: {
      resolveAiProvider: async () => ({
        name: "gemini",
        generateResponse: async () =>
          "Goal too vague; propose a smaller first step.",
      }),
    },
  });

  ({ diagnoseWager } = await import("./wager-diagnosis"));
});

describe("diagnoseWager", () => {
  it("writes a SageInsight and links it on the verdict for a lost wager", async () => {
    await diagnoseWager("w1");
    assert.equal(insightWrites.length, 1, "expected one SageInsight write");
    assert.equal(verdictUpdates.length, 1, "expected one WagerVerdict update");
  });

  it("does nothing when SAGE_WAGER_DIAGNOSIS_ENABLED is not set", async () => {
    insightWrites.length = 0;
    verdictUpdates.length = 0;
    const prev = process.env.SAGE_WAGER_DIAGNOSIS_ENABLED;
    process.env.SAGE_WAGER_DIAGNOSIS_ENABLED = "false";
    await diagnoseWager("w1");
    process.env.SAGE_WAGER_DIAGNOSIS_ENABLED = prev;
    assert.equal(insightWrites.length, 0, "should write nothing when gated off");
    assert.equal(verdictUpdates.length, 0, "should update nothing when gated off");
  });
});
