import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  selectLocalModel,
  type LocalTaskRoutingConfig,
} from "../task-router";
import type {
  AIProviderRequest,
  LocalRoutingContext,
  LocalTaskClass,
} from "../types";

const config: LocalTaskRoutingConfig = {
  enabled: true,
  defaultModel: "gemma4:12b",
  defaultAvailable: true,
  speedModel: "qwen3.5:9b",
  speedAvailable: true,
  qualityModel: "gemma4:26b",
  qualityAvailable: true,
};

const safeMinimalContext: LocalRoutingContext = {
  newConversation: true,
  hasHistory: false,
  hasRag: false,
  hasAttachments: false,
  hasCrisisState: false,
  hasStaffContext: false,
  classificationCertain: true,
  minimalContext: true,
};

function request(
  overrides: Partial<AIProviderRequest> = {},
): AIProviderRequest {
  return {
    studentId: "synthetic-student",
    task: "sage_student_chat",
    sensitivity: "student_record",
    localTaskClass: "casual_chat",
    localPayloadSensitivity: "deidentified",
    localRoutingContext: safeMinimalContext,
    ...overrides,
  };
}

describe("frozen local-routing security matrix", () => {
  it("selects Qwen only for an explicitly de-identified, new, minimal casual request", () => {
    const decision = selectLocalModel(request(), config);
    assert.equal(decision.selectedTier, "speed");
    assert.equal(decision.model, "qwen3.5:9b");
  });

  it("never selects Qwen when the actual local payload remains protected", () => {
    for (const sensitivity of ["student_record", "staff_entered"] as const) {
      const decision = selectLocalModel(
        request({ localPayloadSensitivity: sensitivity }),
        config,
      );
      assert.notEqual(decision.selectedTier, "speed", sensitivity);
      assert.match(decision.model, /gemma/i);
    }
  });

  it("never selects Qwen for history, RAG, attachments, crisis, staff context, or uncertainty", () => {
    const cases: Array<{
      name: string;
      taskClass?: LocalTaskClass;
      context: Partial<LocalRoutingContext>;
    }> = [
      {
        name: "sensitive history",
        context: { newConversation: false, hasHistory: true },
      },
      { name: "RAG", context: { hasRag: true } },
      {
        name: "attachments",
        taskClass: "structured_extraction",
        context: { hasAttachments: true },
      },
      {
        name: "crisis state",
        taskClass: "crisis_safety",
        context: { hasCrisisState: true },
      },
      {
        name: "staff context",
        taskClass: "staff_workflow",
        context: { hasStaffContext: true },
      },
      {
        name: "uncertain classification",
        taskClass: "uncertain",
        context: { classificationCertain: false },
      },
    ];

    for (const testCase of cases) {
      const decision = selectLocalModel(
        request({
          localTaskClass: testCase.taskClass ?? "casual_chat",
          localRoutingContext: {
            ...safeMinimalContext,
            ...testCase.context,
          },
        }),
        config,
      );
      assert.notEqual(
        decision.selectedTier,
        "speed",
        `${testCase.name} selected Qwen`,
      );
      assert.match(decision.model, /gemma/i, testCase.name);
    }
  });

  it("never routes staff work or protected public-preference requests to Qwen", () => {
    const cases: AIProviderRequest[] = [
      request({
        task: "sage_staff_chat",
        sensitivity: "staff_entered",
        localTaskClass: "staff_workflow",
        localPayloadSensitivity: "staff_entered",
        preferCloud: true,
      }),
      request({
        sensitivity: "student_record",
        localPayloadSensitivity: "student_record",
        preferCloud: true,
      }),
    ];

    for (const candidate of cases) {
      const decision = selectLocalModel(candidate, config);
      assert.notEqual(decision.selectedTier, "speed");
      assert.match(decision.model, /gemma/i);
    }
  });
});
