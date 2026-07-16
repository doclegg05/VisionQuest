/* eslint-disable @typescript-eslint/no-explicit-any -- module mocks mirror Prisma's surface */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import type { JobRecommendation } from "@/lib/job-board/types";
import type { JobBandingContext } from "@/lib/job-board/banded-matching";
import type {
  AdvanceCampaignResult,
  CampaignContext,
  CampaignStage,
  CampaignState,
} from "./campaign-orchestrator";

const mockCampaignStepCreate = mock.fn() as any;
const mockCareerCampaignUpdate = mock.fn() as any;
const mockTransaction = mock.fn() as any;

mock.module("@/lib/db", {
  namedExports: {
    prisma: {
      campaignStep: {
        get create() {
          return mockCampaignStepCreate;
        },
      },
      careerCampaign: {
        get update() {
          return mockCareerCampaignUpdate;
        },
      },
      get $transaction() {
        return mockTransaction;
      },
    },
  },
});

let advanceCampaign: typeof import("./campaign-orchestrator").advanceCampaign;
let recordCampaignStep: typeof import("./record-campaign-step").recordCampaignStep;

before(async () => {
  ({ advanceCampaign } = await import("./campaign-orchestrator"));
  ({ recordCampaignStep } = await import("./record-campaign-step"));
});

beforeEach(() => {
  for (const fn of [mockCampaignStepCreate, mockCareerCampaignUpdate, mockTransaction]) {
    fn.mock.resetCalls();
  }
  mockCampaignStepCreate.mock.mockImplementation(async () => ({ id: "step-1" }));
  mockCareerCampaignUpdate.mock.mockImplementation(async () => ({ id: "campaign-1" }));
  mockTransaction.mock.mockImplementation(async (writes: Array<Promise<unknown>>) => Promise.all(writes));
});

function makeRecommendation(overrides: Partial<JobRecommendation> = {}): JobRecommendation {
  return {
    jobListingId: "job-core-1",
    score: 90,
    matchLabel: "Strong match",
    clusterOverlap: ["health-science"],
    skillOverlap: [],
    matchReasons: [],
    ...overrides,
  };
}

const bandingContext: JobBandingContext = {
  topClusters: ["health-science"],
  hollandCode: "SEC",
  transferableSkills: ["patient care"],
};

function makeCampaign(overrides: Partial<CampaignState> = {}): CampaignState {
  return {
    id: "campaign-1",
    studentId: "stu-1",
    currentStage: "discover",
    targetClusters: ["health-science"],
    weeklyApplicationTarget: 3,
    ...overrides,
  };
}

function makeContext(overrides: Partial<CampaignContext> = {}): CampaignContext {
  return {
    recommendations: [makeRecommendation()],
    bandingContext,
    prepStatus: [],
    savedJobs: [],
    ...overrides,
  };
}

describe("advanceCampaign", () => {
  it("moves a fresh campaign DISCOVER -> PREP -> QUEUE -> TRACK in order without skipping a stage", () => {
    const context = makeContext();
    let campaign = makeCampaign({ currentStage: "discover" });
    const seenStages: CampaignStage[] = [];

    for (let i = 0; i < 4; i += 1) {
      const advance = advanceCampaign(campaign, context);
      seenStages.push(advance.stepToLog.stage);
      campaign = { ...campaign, currentStage: advance.nextStage };
    }

    assert.deepEqual(seenStages, ["discover", "prep", "queue", "track"]);

    // TRACK is terminal: repeated advances stay in TRACK, never regress or
    // skip forward past it.
    const trackAdvance = advanceCampaign(campaign, context);
    assert.equal(trackAdvance.nextStage, "track");
    assert.equal(trackAdvance.stepToLog.stage, "track");
  });

  it("surfaces bandRankedJobs Core/Stretch/Wildcard candidates in DISCOVER", () => {
    const core = makeRecommendation({
      jobListingId: "job-core",
      score: 90,
      clusterOverlap: ["health-science"],
    });
    const stretch = makeRecommendation({
      jobListingId: "job-stretch",
      score: 60,
      clusterOverlap: [],
      skillOverlap: ["patient care"],
    });
    const wildcard = makeRecommendation({
      jobListingId: "job-wildcard",
      score: 40,
      clusterOverlap: [],
      skillOverlap: [],
    });
    const context = makeContext({ recommendations: [core, stretch, wildcard] });
    const campaign = makeCampaign({ currentStage: "discover" });

    const advance = advanceCampaign(campaign, context);

    assert.equal(advance.proposedActions.length, 1);
    const [reviewAction] = advance.proposedActions;
    assert.equal(reviewAction.type, "review_job_bands");
    assert.equal(reviewAction.riskTier, "read");
    assert.deepEqual(reviewAction.data?.core, ["job-core"]);
    assert.deepEqual(reviewAction.data?.stretch, ["job-stretch"]);
    assert.deepEqual(reviewAction.data?.wildcard, ["job-wildcard"]);
  });

  it("proposes a consequential tailor_application for an un-prepped job in PREP, with no provider/DB/tool call", () => {
    const context = makeContext({
      recommendations: [makeRecommendation({ jobListingId: "job-core" })],
      prepStatus: [],
    });
    const campaign = makeCampaign({ currentStage: "prep" });

    const advance = advanceCampaign(campaign, context);

    assert.equal(advance.proposedActions.length, 1);
    const [action] = advance.proposedActions;
    assert.equal(action.type, "tailor_application");
    assert.equal(action.riskTier, "mutate_consequential");
    assert.equal(action.jobListingId, "job-core");

    // Purity: advanceCampaign() must never touch the DB/provider layer.
    assert.equal(mockCampaignStepCreate.mock.callCount(), 0);
    assert.equal(mockCareerCampaignUpdate.mock.callCount(), 0);
    assert.equal(mockTransaction.mock.callCount(), 0);
  });

  it("does not re-propose tailor_application once a resume and cover letter already exist", () => {
    const context = makeContext({
      recommendations: [makeRecommendation({ jobListingId: "job-core" })],
      prepStatus: [{ jobListingId: "job-core", hasResumeVersion: true, hasCoverLetter: true }],
    });
    const campaign = makeCampaign({ currentStage: "prep" });

    const advance = advanceCampaign(campaign, context);

    assert.equal(advance.proposedActions.length, 1);
    assert.equal(advance.proposedActions[0].type, "check_in");
    assert.notEqual(advance.proposedActions[0].riskTier, "mutate_consequential");
  });

  it("caps QUEUE proposals at the weekly application target and holds the rest", () => {
    const recs = [
      makeRecommendation({ jobListingId: "job-1" }),
      makeRecommendation({ jobListingId: "job-2" }),
      makeRecommendation({ jobListingId: "job-3" }),
    ];
    const context = makeContext({
      recommendations: recs,
      prepStatus: recs.map((r) => ({
        jobListingId: r.jobListingId,
        hasResumeVersion: true,
        hasCoverLetter: true,
      })),
    });
    const campaign = makeCampaign({ currentStage: "queue", weeklyApplicationTarget: 2 });

    const advance = advanceCampaign(campaign, context);

    const queued = advance.proposedActions.filter((a) => a.type === "queue_submission");
    const held = advance.proposedActions.filter((a) => a.type === "hold_for_next_week");
    assert.equal(queued.length, 2);
    assert.equal(held.length, 1);
    assert.ok(queued.every((a) => a.riskTier === "mutate_consequential"));
    assert.ok(held.every((a) => a.riskTier === "read"));
  });

  it("excludes jobs already acted on (e.g. applied) from QUEUE", () => {
    const context = makeContext({
      recommendations: [makeRecommendation({ jobListingId: "job-1" })],
      prepStatus: [{ jobListingId: "job-1", hasResumeVersion: true, hasCoverLetter: true }],
      savedJobs: [{ jobListingId: "job-1", status: "applied" }],
    });
    const campaign = makeCampaign({ currentStage: "queue" });

    const advance = advanceCampaign(campaign, context);

    assert.equal(advance.proposedActions.length, 0);
  });

  it("proposes read-only check-ins on in-flight applications in TRACK", () => {
    const context = makeContext({
      savedJobs: [
        { jobListingId: "job-1", status: "applied" },
        { jobListingId: "job-2", status: "interviewing" },
        { jobListingId: "job-3", status: "saved" },
      ],
    });
    const campaign = makeCampaign({ currentStage: "track" });

    const advance = advanceCampaign(campaign, context);

    assert.equal(advance.proposedActions.length, 2);
    assert.ok(advance.proposedActions.every((a) => a.type === "check_in" && a.riskTier === "read"));
  });

  it("every advance returns a CampaignStep to log matching the stage it just processed", () => {
    const context = makeContext();
    const campaign = makeCampaign({ currentStage: "prep" });

    const advance = advanceCampaign(campaign, context);

    assert.equal(advance.stepToLog.stage, "prep");
    assert.deepEqual(advance.stepToLog.proposedActions, advance.proposedActions);
  });
});

describe("recordCampaignStep", () => {
  it("persists the step and advances currentStage in one transaction (mocked prisma)", async () => {
    const advance: AdvanceCampaignResult = {
      nextStage: "prep",
      proposedActions: [],
      stepToLog: { stage: "discover", proposedActions: [] },
    };

    const result = await recordCampaignStep("campaign-1", advance);

    assert.equal(result.stepId, "step-1");
    assert.equal(mockTransaction.mock.callCount(), 1);
    assert.equal(mockCampaignStepCreate.mock.callCount(), 1);
    assert.equal(mockCareerCampaignUpdate.mock.callCount(), 1);

    const stepWrite = mockCampaignStepCreate.mock.calls[0].arguments[0];
    assert.equal(stepWrite.data.campaignId, "campaign-1");
    assert.equal(stepWrite.data.stage, "discover");

    const campaignWrite = mockCareerCampaignUpdate.mock.calls[0].arguments[0];
    assert.equal(campaignWrite.where.id, "campaign-1");
    assert.equal(campaignWrite.data.currentStage, "prep");
  });
});
