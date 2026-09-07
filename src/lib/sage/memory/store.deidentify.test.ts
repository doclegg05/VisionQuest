/* eslint-disable @typescript-eslint/no-explicit-any -- mock scaffolding must accept many signatures */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import type { MemoryCandidate } from "./schema";

/**
 * AC4 — the write-time de-identification pass.
 *
 * A memory row is not a transcript: it is replayed into EVERY future prompt
 * for that student, on whichever provider is configured that day. So the
 * substitution here is PERMANENT — there is no vault at read time to reverse
 * it, and that is the point (FERPA review memo B §2.c.4, which found that the
 * extractor's "do not record facts about other people by name" is an
 * instruction to a model, not an enforcement).
 *
 * The pass runs before the source hash, before the embedding and before the
 * insert, so the hash matches what is stored and the vector never encodes a
 * phone number either.
 */

const mockEmbedTexts = mock.fn(async (texts: string[]) => texts.map(() => [1, 0, 0, 0])) as any;
const mockCreate = mock.fn(async () => ({ id: "mem-1" })) as any;
const mockLoadIdentityInput = mock.fn(async () => ({ studentName: "Jordan Lee" })) as any;

mock.module("@/lib/db", {
  namedExports: {
    prisma: {
      sageMemory: { findMany: async () => [], create: mockCreate },
      $executeRaw: async () => 1,
      $queryRaw: async () => [],
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({ $executeRaw: async () => 1 }),
    },
  },
});
mock.module("@/lib/ai/embeddings", {
  namedExports: {
    embedTexts: mockEmbedTexts,
    toVectorLiteral: (vector: number[]) => `[${vector.join(",")}]`,
  },
});
mock.module("@/lib/ai/embedding-provider", {
  namedExports: { getActiveEmbeddingModel: async () => "gemini-embedding-001" },
});
mock.module("@/lib/ai/identity", {
  namedExports: {
    loadIdentityInput: mockLoadIdentityInput,
    listManagedRosterNames: async () => [],
    MANAGED_ROSTER_CAP: 500,
    clearIdentityCache: () => {},
  },
});

let storeMemoryCandidates: typeof import("./store").storeMemoryCandidates;

before(async () => {
  ({ storeMemoryCandidates } = await import("./store"));
});

beforeEach(() => {
  mockEmbedTexts.mock.resetCalls();
  mockCreate.mock.resetCalls();
  mockLoadIdentityInput.mock.resetCalls();
  mockLoadIdentityInput.mock.mockImplementation(async () => ({ studentName: "Jordan Lee" }));
});

function candidate(content: string): MemoryCandidate {
  return {
    subjectType: "student",
    subjectId: "stu1",
    kind: "semantic",
    content,
    category: "circumstance",
    confidence: 0.8,
    sourceType: "conversation",
    sourceId: "conv-1",
  };
}

async function store(content: string): Promise<{ stored: string; embedded: string }> {
  await storeMemoryCandidates([candidate(content)], {
    usage: { studentId: "stu1", callSite: "sage_memory_extract" },
    semanticDedupe: false,
  });
  return {
    stored: String((mockCreate.mock.calls[0].arguments[0] as any).data.content),
    embedded: String((mockEmbedTexts.mock.calls[0].arguments[0] as string[])[0]),
  };
}

describe("storeMemoryCandidates — write-time de-identification", () => {
  it("stores neither the phone nor the address a student typed", async () => {
    const { stored } = await store("Jordan's number is 304-555-0134 and she lives at 12 Oak Street");
    assert.ok(!stored.includes("304"), stored);
    assert.ok(!stored.includes("0134"), stored);
    assert.ok(!stored.includes("Oak Street"), stored);
    assert.ok(!stored.includes("Jordan"), stored);
    assert.match(stored, /\[PHONE_1\]/);
    assert.match(stored, /\[ADDRESS_1\]/);
  });

  it("stores the student's own name as a token", async () => {
    const { stored } = await store("Jordan Lee wants a CNA job by December");
    assert.equal(stored, "[STUDENT_NAME] wants a CNA job by December");
  });

  it("stores an email and a date of birth as tokens", async () => {
    const { stored } = await store("Reach her at jordan.lee@example.org; born 3/14/1987");
    assert.match(stored, /\[EMAIL_1\]/);
    assert.match(stored, /\[DOB_1\]/);
    assert.ok(!stored.includes("example.org"));
    assert.ok(!stored.includes("1987"));
  });

  it("embeds the pseudonymised text, so the vector never encodes the phone number", async () => {
    const { stored, embedded } = await store("call 304-555-0134 about the interview");
    assert.equal(embedded, stored);
    assert.ok(!embedded.includes("0134"));
  });

  it("DOCUMENTED LIMIT: a third-party name is still stored", async () => {
    // memo B §2.c.4 and §2.b: the app knows every name in the cohort and
    // nothing else. "my son Jayden", "my caseworker Brenda" — third parties
    // outside the roster — cannot be caught by anything shippable here, and
    // no NER library in reach changes that without costing more latency than
    // the whole cloud lane is trying to save. This test asserts the LEAK so
    // that closing it later is a deliberate change with a red test, not an
    // accident; it is not a pass.
    const { stored } = await store("her son Jayden has asthma");
    assert.equal(stored, "her son Jayden has asthma");
  });

  it("stores the raw content when no identity can be loaded — the free-text families still run", async () => {
    mockLoadIdentityInput.mock.mockImplementation(async () => ({}));
    const { stored } = await store("call 304-555-0134 tomorrow");
    // An empty vault would issue no tokens at all; the write path builds one
    // with free-text detection on regardless, because contact details a
    // student typed are the point of this pass.
    assert.match(stored, /\[PHONE_1\]/);
  });

  it("never fails a memory write because the identity lookup failed", async () => {
    mockLoadIdentityInput.mock.mockImplementation(async () => {
      throw new Error("db down");
    });
    const { stored } = await store("call 304-555-0134 tomorrow");
    assert.match(stored, /\[PHONE_1\]/);
  });

  it("leaves the 988 crisis line verbatim in a stored memory", async () => {
    const { stored } = await store("Jordan Lee has the 988 number saved");
    assert.equal(stored, "[STUDENT_NAME] has the 988 number saved");
  });

  it("hashes what it stores, so dedupe and the row agree", async () => {
    const { sourceHashFor } = await import("./schema");
    const { stored } = await store("Jordan Lee wants a CNA job by December");
    const row = mockCreate.mock.calls[0].arguments[0] as any;
    assert.equal(
      row.data.sourceHash,
      sourceHashFor({ subjectType: "student", subjectId: "stu1", content: stored }),
    );
  });
});
