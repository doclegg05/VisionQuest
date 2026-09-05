// =============================================================================
// draftEndorsement — the model call.
//
// endorsement-shared.test.ts exercises the grounding check on adversarial text
// without a provider. This file is about the wrapper's four obligations, each
// of which fails silently if it is wrong:
//
//   1. REFUSE the cloud. The prompt carries one named student's employers,
//      credentials and attendance, written to be sent outside the program, and
//      `resolveAiProvider` documents a fail-open to cloud (VQ-R-002).
//   2. AUDIT every exit. The FERPA accountability report reads AuditLog; a
//      student_record call that skips it is invisible exactly where the review
//      looks.
//   3. Attribute the INSTRUCTOR as the actor and the student as the target.
//   4. Refuse an ungrounded draft OUTRIGHT rather than trimming it.
// =============================================================================

import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";

import type { EndorsementFacts } from "./endorsement-shared";

const auditEvents: Record<string, unknown>[] = [];
const generateResponse = mock.fn(async () => "Dana finished the Forklift Operator card.");
let providerName = "ollama";

mock.module("@/lib/ai/audit", {
  namedExports: {
    getProviderClass: (name: string) => (name === "ollama" ? "local" : "cloud"),
    policyDecisionForProvider: () => "local_required",
    logAiAuditEvent: async (event: Record<string, unknown>) => {
      auditEvents.push(event);
    },
  },
});

mock.module("@/lib/ai/provider", {
  namedExports: {
    resolveAiProvider: async () => ({
      name: providerName,
      generateResponse: (...args: unknown[]) => generateResponse(...(args as [])),
    }),
  },
});

mock.module("@/lib/llm-usage", {
  namedExports: {
    // Pass the provider straight through; usage logging is not what is under
    // test and wrapping it would only hide the call.
    withUsageLogging: (provider: unknown) => provider,
  },
});

let draftEndorsement: typeof import("./endorsement").draftEndorsement;

before(async () => {
  ({ draftEndorsement } = await import("./endorsement"));
});

const FACTS: EndorsementFacts = {
  verifiedCertifications: ["Forklift Operator"],
  skills: ["pallet jack", "inventory counts"],
  employers: ["Beckley Components"],
  attendanceSummary: "Present for every class so far.",
  instructorNotes: null,
};

const ACTOR = { id: "tea1", role: "teacher" };

beforeEach(() => {
  auditEvents.length = 0;
  generateResponse.mock.resetCalls();
  generateResponse.mock.mockImplementation(
    async () => "Dana finished the Forklift Operator card.",
  );
  providerName = "ollama";
});

function eventsByStatus(status: string) {
  return auditEvents.filter((event) => event.status === status);
}

describe("draftEndorsement", () => {
  it("returns the draft and audits the call as routed then completed", async () => {
    const result = await draftEndorsement("stu1", "Dana Whitaker", FACTS, ACTOR);

    assert.deepEqual(result, {
      status: "ok",
      text: "Dana finished the Forklift Operator card.",
    });
    assert.deepEqual(
      auditEvents.map((event) => event.status),
      ["routed", "completed"],
    );
  });

  it("records the INSTRUCTOR as the actor and the student as the target", async () => {
    // The first cut recorded the student as an actor with the role "teacher",
    // which is wrong in both halves and would have mis-attributed every row in
    // the FERPA accountability report — the report is by actor.
    await draftEndorsement("stu1", "Dana Whitaker", FACTS, ACTOR);

    for (const event of auditEvents) {
      assert.equal(event.actorId, "tea1");
      assert.equal(event.actorRole, "teacher");
      assert.equal(event.targetId, "stu1");
      assert.equal(event.sensitivity, "student_record");
      assert.equal(event.route, "connect.draft_endorsement");
    }
  });

  it("REFUSES a cloud-routed provider and never calls it", async () => {
    // sensitivity: "student_record" asks for local-only routing, but
    // resolveAiProvider deliberately fails OPEN to cloud when the local
    // provider is down. Most student_record prompts can live with that; a
    // paragraph naming one student's employers and credentials, written to be
    // sent outside the program, is the wrong place to inherit an open ruling.
    providerName = "gemini";

    const result = await draftEndorsement("stu1", "Dana Whitaker", FACTS, ACTOR);

    assert.deepEqual(result, { status: "refused", reason: "cloud_blocked" });
    assert.equal(
      generateResponse.mock.callCount(),
      0,
      "the student's record reached a cloud provider",
    );

    const [blocked] = eventsByStatus("blocked");
    assert.ok(blocked, "a blocked FERPA call must still be audited");
    assert.equal(blocked.providerClass, "cloud");
    assert.equal(blocked.allowCloud, false);
    assert.equal(blocked.targetId, "stu1");
  });

  it("never reports allowCloud on a call it let through", async () => {
    await draftEndorsement("stu1", "Dana Whitaker", FACTS, ACTOR);
    for (const event of auditEvents) {
      assert.equal(event.allowCloud, false);
      assert.equal(event.providerClass, "local");
    }
  });

  it("refuses an UNGROUNDED draft outright, and says so on the audit row", async () => {
    // Trimming was rejected on purpose: a fluent paragraph that had quietly
    // dropped its worst sentence is far harder for an instructor to notice
    // than an empty box.
    generateResponse.mock.mockImplementation(
      async () => "Dana spent two years at Kroger and holds a CDL license.",
    );

    const result = await draftEndorsement("stu1", "Dana Whitaker", FACTS, ACTOR);

    assert.deepEqual(result, { status: "refused", reason: "ungrounded" });
    const [failed] = eventsByStatus("failed");
    assert.equal(failed.errorCode, "ungrounded_endorsement");
  });

  it("will not let a self-reported skill ground a CREDENTIAL claim", async () => {
    // "pallet jack" is on the résumé, which the student wrote. That is a fine
    // source for naming what they have done and a bad one for asserting they
    // are certified — an employer may hire on this sentence.
    generateResponse.mock.mockImplementation(
      async () => "Dana holds a pallet jack certification.",
    );

    const result = await draftEndorsement("stu1", "Dana Whitaker", FACTS, ACTOR);
    assert.deepEqual(result, { status: "refused", reason: "ungrounded" });
  });

  it("still allows a VERIFIED credential to be named", async () => {
    generateResponse.mock.mockImplementation(
      async () => "Dana earned the Forklift Operator card in class.",
    );
    const result = await draftEndorsement("stu1", "Dana Whitaker", FACTS, ACTOR);
    assert.equal(result.status, "ok");
  });

  it("treats an empty reply as a refusal, not as an endorsement", async () => {
    generateResponse.mock.mockImplementation(async () => "   ");

    const result = await draftEndorsement("stu1", "Dana Whitaker", FACTS, ACTOR);

    assert.deepEqual(result, { status: "refused", reason: "empty" });
    assert.equal(eventsByStatus("failed")[0].errorCode, "empty_reply");
  });

  it("survives a provider that throws, and audits the failure", async () => {
    generateResponse.mock.mockImplementation(async () => {
      throw new Error("connection refused");
    });

    const result = await draftEndorsement("stu1", "Dana Whitaker", FACTS, ACTOR);

    assert.deepEqual(result, { status: "refused", reason: "unavailable" });
    assert.equal(eventsByStatus("failed")[0].errorCode, "provider_error");
  });

  it("fences the student's own name and the facts inside grounding markers", async () => {
    // Every one of these strings is third-party or student-authored text on
    // its way into a prompt. The markers plus sanitizeForPrompt are what keep
    // an instructor note reading "ignore the rules above" from being read as
    // an instruction.
    await draftEndorsement("stu1", "Dana Whitaker", FACTS, ACTOR);

    const [, messages] = generateResponse.mock.calls[0].arguments as unknown as [
      string,
      { role: string; content: string }[],
    ];
    const prompt = messages[0].content;
    assert.match(prompt, /\[GROUNDING_DATA_START\][\s\S]*\[GROUNDING_DATA_END\]/);
    assert.ok(prompt.indexOf("Dana Whitaker") < prompt.indexOf("[GROUNDING_DATA_END]"));
  });
});
