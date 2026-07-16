/**
 * Career Campaign Orchestrator — planner core (MVP).
 * Design: docs (Campaign Orchestrator MVP, follow-up to the Sage full-service
 * career agent design). Sage runs a student's job search as a resumable
 * DISCOVER → PREP → QUEUE → TRACK campaign.
 *
 * advanceCampaign() is a PURE function: no DB, no network, no provider/tool
 * calls. It only ever PROPOSES actions — it never executes anything
 * consequential (that mirrors tailor-application.ts and the executor's
 * confirmation gate: a "mutate_consequential" proposal here still has to
 * pass through the normal confirm-then-execute path elsewhere before
 * anything happens). Persistence is confined to the thin caller in
 * ./record-campaign-step.ts so this module stays deterministic and
 * unit-testable without a database.
 */
import type { JobRecommendation, SavedJobStatus } from "@/lib/job-board/types";
import { bandRankedJobs, type JobBandingContext } from "@/lib/job-board/banded-matching";
import type { RiskTier } from "@/lib/sage/agent/types";

/** Resumable stage order. TRACK is terminal — once reached, the campaign
 *  keeps monitoring (repeated advances stay in TRACK; they never regress
 *  or skip forward past it). */
export const CAMPAIGN_STAGES = ["discover", "prep", "queue", "track"] as const;
export type CampaignStage = (typeof CAMPAIGN_STAGES)[number];

/** Minimal campaign snapshot the planner needs. Deliberately decoupled from
 *  the Prisma row shape so this module never imports @prisma/client. */
export interface CampaignState {
  readonly id: string;
  readonly studentId: string;
  readonly currentStage: CampaignStage;
  readonly targetClusters: readonly string[];
  readonly weeklyApplicationTarget: number;
}

/** Whether a job already has tailored application artifacts (from
 *  tailor-application.ts's ResumeVersion/CoverLetter rows). */
export interface JobPrepStatus {
  readonly jobListingId: string;
  readonly hasResumeVersion: boolean;
  readonly hasCoverLetter: boolean;
}

/** A student's existing StudentSavedJob pipeline state for a job. */
export interface SavedJobPipelineEntry {
  readonly jobListingId: string;
  readonly status: SavedJobStatus;
}

/**
 * Everything advanceCampaign() needs, gathered by the caller ahead of time.
 * Nothing in this shape is fetched by the planner itself.
 */
export interface CampaignContext {
  readonly recommendations: readonly JobRecommendation[];
  readonly bandingContext: JobBandingContext;
  readonly wildcardCap?: number;
  readonly prepStatus: readonly JobPrepStatus[];
  readonly savedJobs: readonly SavedJobPipelineEntry[];
}

export type ProposedActionType =
  | "review_job_bands"
  | "tailor_application"
  | "queue_submission"
  | "hold_for_next_week"
  | "check_in";

/** A single proposed next action. `riskTier` documents what WOULD happen if
 *  a human approves it — the planner never performs the action itself. */
export interface ProposedAction {
  readonly type: ProposedActionType;
  readonly riskTier: RiskTier;
  readonly summary: string;
  readonly jobListingId?: string;
  readonly data?: Record<string, unknown>;
}

export interface CampaignStepLog {
  readonly stage: CampaignStage;
  readonly proposedActions: readonly ProposedAction[];
}

export interface AdvanceCampaignResult {
  readonly nextStage: CampaignStage;
  readonly proposedActions: readonly ProposedAction[];
  readonly stepToLog: CampaignStepLog;
}

function nextStageAfter(stage: CampaignStage): CampaignStage {
  const index = CAMPAIGN_STAGES.indexOf(stage);
  const next = CAMPAIGN_STAGES[index + 1];
  return next ?? "track";
}

/** Core + Stretch jobs are the ones worth investing prep time on; Wildcard
 *  jobs are surfaced for browsing in DISCOVER but not auto-carried into PREP. */
function prepCandidateJobIds(context: CampaignContext): readonly string[] {
  const banded = bandRankedJobs(context.recommendations, context.bandingContext, context.wildcardCap);
  const ids = [...banded.core.jobs, ...banded.stretch.jobs].map((job) => job.jobListingId);
  return [...new Set(ids)];
}

function isPrepped(jobListingId: string, prepStatus: readonly JobPrepStatus[]): boolean {
  const status = prepStatus.find((entry) => entry.jobListingId === jobListingId);
  return Boolean(status?.hasResumeVersion && status?.hasCoverLetter);
}

/** A job the student has already moved past "saved" (applied, withdrawn,
 *  etc.) shouldn't be re-queued. */
function hasBeenActedOn(jobListingId: string, savedJobs: readonly SavedJobPipelineEntry[]): boolean {
  return savedJobs.some((entry) => entry.jobListingId === jobListingId && entry.status !== "saved");
}

function planDiscover(context: CampaignContext): readonly ProposedAction[] {
  const banded = bandRankedJobs(context.recommendations, context.bandingContext, context.wildcardCap);
  return [
    {
      type: "review_job_bands",
      riskTier: "read",
      summary:
        `Reviewed ${context.recommendations.length} matches: ` +
        `${banded.core.jobs.length} Core, ${banded.stretch.jobs.length} Stretch, ` +
        `${banded.wildcard.jobs.length} Wildcard.`,
      data: {
        core: banded.core.jobs.map((job) => job.jobListingId),
        stretch: banded.stretch.jobs.map((job) => job.jobListingId),
        wildcard: banded.wildcard.jobs.map((job) => job.jobListingId),
      },
    },
  ];
}

function planPrep(context: CampaignContext): readonly ProposedAction[] {
  return prepCandidateJobIds(context).map((jobListingId) =>
    isPrepped(jobListingId, context.prepStatus)
      ? {
          type: "check_in" as const,
          riskTier: "read" as const,
          jobListingId,
          summary: `Resume and cover letter already tailored for job ${jobListingId} — ready to queue.`,
        }
      : {
          type: "tailor_application" as const,
          riskTier: "mutate_consequential" as const,
          jobListingId,
          summary: `Propose tailoring a resume and cover letter for job ${jobListingId}.`,
        },
  );
}

function planQueue(campaign: CampaignState, context: CampaignContext): readonly ProposedAction[] {
  const readyToQueue = prepCandidateJobIds(context).filter(
    (jobListingId) =>
      isPrepped(jobListingId, context.prepStatus) && !hasBeenActedOn(jobListingId, context.savedJobs),
  );
  const cap = Math.max(0, campaign.weeklyApplicationTarget);
  const toQueue = readyToQueue.slice(0, cap);
  const held = readyToQueue.slice(cap);

  return [
    ...toQueue.map((jobListingId) => ({
      type: "queue_submission" as const,
      riskTier: "mutate_consequential" as const,
      jobListingId,
      summary: `Propose submitting the tailored application for job ${jobListingId}.`,
    })),
    ...held.map((jobListingId) => ({
      type: "hold_for_next_week" as const,
      riskTier: "read" as const,
      jobListingId,
      summary: `Ready to submit for job ${jobListingId}, held back by the weekly target of ${cap}.`,
    })),
  ];
}

function planTrack(context: CampaignContext): readonly ProposedAction[] {
  const inFlight = context.savedJobs.filter(
    (entry) => entry.status === "applied" || entry.status === "interviewing" || entry.status === "offered",
  );
  return inFlight.map((entry) => ({
    type: "check_in" as const,
    riskTier: "read" as const,
    jobListingId: entry.jobListingId,
    summary: `Check in on job ${entry.jobListingId} (${entry.status}).`,
  }));
}

/**
 * Advance a campaign by one planner step. Pure and total: given the current
 * stage, it always returns a valid next stage in DISCOVER → PREP → QUEUE →
 * TRACK order (never skips a stage) plus the actions Sage should propose for
 * the stage it just evaluated. Persist the result with recordCampaignStep().
 */
export function advanceCampaign(campaign: CampaignState, context: CampaignContext): AdvanceCampaignResult {
  const stage = campaign.currentStage;
  const proposedActions =
    stage === "discover"
      ? planDiscover(context)
      : stage === "prep"
        ? planPrep(context)
        : stage === "queue"
          ? planQueue(campaign, context)
          : planTrack(context);

  return {
    nextStage: nextStageAfter(stage),
    proposedActions,
    stepToLog: { stage, proposedActions },
  };
}
