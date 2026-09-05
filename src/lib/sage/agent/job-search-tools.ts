// =============================================================================
// search_jobs / explain_job — the student-facing half of Match & Connect's
// Phase 2 (docs/superpowers/plans/2026-09-05-match-and-connect.md, Task 2.3).
//
// Both are READ tools. Neither can produce a job that is not a row on the
// student's own class board:
//   - search_jobs ranks the board with the SAME scorer /api/jobs uses
//     (rankJobs), applies the work profile's hard blocks, and returns at most
//     three rows plus a reason assembled from the scorer's own matchReasons.
//     No prose is generated here at all.
//   - explain_job rewrites ONE posting into a fixed five-section template on
//     the LOCAL provider (student_record sensitivity), and is told to say
//     "The posting doesn't say." for any field the posting lacks rather than
//     filling the gap.
//
// Phase 3 adds JobLead to both. The scoping choke point is deliberately the
// same one the other career tools use: enrollment -> JobClassConfig -> rows.
// =============================================================================

import { resolveAiProvider } from "@/lib/ai/provider";
import { prisma } from "@/lib/db";
import {
  getWorkProfile,
  transportFeasible,
  type WorkProfile,
} from "@/lib/connect/work-profile";
import { describeLeadPay } from "@/lib/connect/leads-shared";
import { rankLeadsForStudent } from "@/lib/connect/matching";
import { dedupeJobsForDisplay } from "@/lib/job-board/duplicates";
import { buildJobFilterWhere, parseJobFilters } from "@/lib/job-board/job-filters";
import {
  buildJobInteractionProfile,
  buildStudentJobProfile,
  parseTransferableSkillNames,
  rankJobs,
  type LocalJobPriority,
} from "@/lib/job-board/recommendation";
import { withUsageLogging } from "@/lib/llm-usage";
import { parseStoredResumeData } from "@/lib/resume";
import { assessReadability, PLAIN_LANGUAGE_IDEAL_GRADE } from "@/lib/sage/readability";
import type { AgentTool, AgentToolResult } from "./types";

const MAX_RESULTS = 3;

/**
 * A JobListing carries no transit note and no distance to the student's home —
 * only Phase 3's JobLead will. So transportFeasible() sees an empty lead here,
 * which means it can only ever return "no" for a student who said they have no
 * way to get anywhere ("none"), and "unknown" for bus and walk. That is the
 * intended behaviour: an unknown never hides a job.
 */
const EMPTY_LEAD = { transitNotes: null, distanceMiles: null } as const;

interface BoardContext {
  classConfigId: string;
  region: string;
  priority: LocalJobPriority;
}

async function resolveBoard(studentId: string): Promise<BoardContext | null> {
  const enrollment = await prisma.studentClassEnrollment.findFirst({
    where: { studentId, status: "active" },
    select: { classId: true },
  });
  if (!enrollment) return null;

  const config = await prisma.jobClassConfig.findUnique({
    where: { classId: enrollment.classId },
  });
  if (!config) return null;

  return {
    classConfigId: config.id,
    region: config.region,
    priority: (config.localJobPriority ?? "prefer_local") as LocalJobPriority,
  };
}

/** Why a job is not shown. Null means it is shown. */
function hardBlockReason(
  job: { salaryMin: number | null },
  profile: WorkProfile | null,
): string | null {
  if (!profile) return null;

  // Pay: only a KNOWN rate below the floor blocks. salaryMin is normalized to
  // an hourly figure by the salary parser, the same unit as payFloorHourly.
  // A posting with no pay stays in the list — "unknown" is not "too little".
  if (
    profile.payFloorHourly !== null &&
    job.salaryMin !== null &&
    job.salaryMin < profile.payFloorHourly
  ) {
    return "pay_below_floor";
  }

  if (transportFeasible(profile, EMPTY_LEAD) === "no") {
    return "no_way_to_get_there";
  }

  return null;
}

function oneSentenceReason(
  labels: string[],
  job: { title: string; company: string; location: string },
): string {
  const parts = labels
    .slice(0, 2)
    .map((label) => label.replace(/\.+$/, "").trim())
    .filter((label) => label.length > 0);
  if (parts.length === 0) {
    return `${job.title} at ${job.company} in ${job.location}.`;
  }
  return `${parts.join(". ")}.`;
}

const searchJobs: AgentTool = {
  name: "search_jobs",
  description:
    "Find the jobs on the student's class job board that fit them best. Returns at most three " +
    "real postings with a short reason for each, using their saved work answers (pay they need, " +
    "how they get to work) to leave out jobs that would not work. Read-only. Name only the jobs " +
    "this tool returns.",
  parameters: { type: "object", properties: {} },
  slashCommand: {
    command: "/jobs",
    label: "Jobs that fit me",
    description: "Three jobs from your class board that fit you",
  },
  requiredRoles: ["student"],
  riskTier: "read",
  enabled: true,
  async execute(_args, ctx): Promise<AgentToolResult> {
    const studentId = ctx.session.id;

    const board = await resolveBoard(studentId);
    if (!board) {
      return {
        status: "error",
        summary: "I couldn't find a job board for your class yet.",
        modelHint:
          "The student has no active enrollment or their class has no job board configured. " +
          "Tell them plainly and suggest they ask their instructor. Do NOT invent jobs.",
      };
    }

    // The same filters /api/jobs applies to the class board.
    const where: Record<string, unknown> = {
      classConfigId: board.classConfigId,
      status: "active",
    };
    if (board.priority === "local_only") {
      // The teacher has chosen to hide remote roles for this class. Hybrid
      // stays: an in-region hybrid role still classifies as local.
      where.workMode = { not: "remote" };
    }
    Object.assign(where, buildJobFilterWhere(parseJobFilters(new URLSearchParams()), new Date()));

    const listings = await prisma.jobListing.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    const jobs = dedupeJobsForDisplay(listings);

    const [savedJobs, discovery, resumeRecord, workProfile, leadFits] = await Promise.all([
      prisma.studentSavedJob.findMany({
        where: { studentId },
        select: {
          status: true,
          jobListing: { select: { clusters: true, company: true, source: true } },
        },
      }),
      prisma.careerDiscovery.findUnique({
        where: { studentId },
        select: { topClusters: true, hollandCode: true, transferableSkills: true },
      }),
      prisma.resumeData.findUnique({ where: { studentId }, select: { data: true } }),
      getWorkProfile(studentId),
      // Phase 3: employer-linked leads an instructor entered, already hard-
      // block-filtered and class-scoped by rankLeadsForStudent.
      rankLeadsForStudent(studentId, { limit: 25 }),
    ]);

    const resume = resumeRecord ? parseStoredResumeData(resumeRecord.data) : null;
    const studentProfile = buildStudentJobProfile({
      resumeSkills: resume?.skills,
      resumeCertifications: resume?.certifications.map((cert) => cert.name),
      resumeExperienceTitles: resume?.experience.map((item) => item.title),
      discoverySkills: parseTransferableSkillNames(discovery?.transferableSkills),
    });
    const interactionProfile = buildJobInteractionProfile(savedJobs);

    const ranked = rankJobs(
      jobs,
      discovery,
      board.region,
      studentProfile,
      interactionProfile,
      board.priority,
    );
    const byId = new Map(jobs.map((job) => [job.id, job]));

    const blocks = new Map<string, string>();

    // A candidate is either a scraped posting from the class board or an
    // employer-linked lead an instructor entered (Phase 3). Both are ranked on
    // the same 0-100 scale — leads by fit(), listings by the job-board scorer —
    // so the three shown are genuinely the three best, not "leads first".
    interface Candidate {
      kind: "lead" | "listing";
      jobListingId?: string;
      jobLeadId?: string;
      title: string;
      company: string;
      location: string;
      salary: string | null;
      matchLabel: string | null;
      reason: string;
      score: number;
    }
    const candidates: Candidate[] = [];

    for (const rec of ranked) {
      const job = byId.get(rec.jobListingId);
      if (!job) continue;

      const block = hardBlockReason(job, workProfile);
      if (block) {
        blocks.set(job.id, block);
        continue;
      }

      candidates.push({
        kind: "listing",
        jobListingId: job.id,
        title: job.title,
        company: job.company,
        location: job.location,
        salary: job.salary,
        matchLabel: rec.matchLabel,
        reason: oneSentenceReason(
          rec.matchReasons.map((reason) => reason.label),
          job,
        ),
        score: rec.score,
      });
    }

    // rankLeadsForStudent has already dropped every hard-blocked lead and
    // applied the same class scoping the RLS policy enforces.
    for (const entry of leadFits) {
      candidates.push({
        kind: "lead",
        jobLeadId: entry.lead.id,
        title: entry.lead.title,
        company: entry.lead.employerName,
        location: entry.lead.location,
        salary: describeLeadPay(entry.lead),
        matchLabel: null,
        reason: entry.fit.reasons.join(" ") ||
          `${entry.lead.title} at ${entry.lead.employerName} in ${entry.lead.location}.`,
        score: entry.fit.score,
      });
    }

    const shown = candidates.sort((a, b) => b.score - a.score).slice(0, MAX_RESULTS);

    const blockedCount = blocks.size;
    const blockedForPay = [...blocks.values()].filter((r) => r === "pay_below_floor").length;
    const blockedForRide = [...blocks.values()].filter((r) => r === "no_way_to_get_there").length;

    if (shown.length === 0) {
      const because =
        blockedForRide > 0
          ? "Every job on the board was left out because they said they have no way to get there yet."
          : blockedForPay > 0
            ? "Every job on the board pays less than the floor they set."
            : "Their class job board has no open postings and no leads right now.";
      return {
        status: "success",
        summary:
          blockedForRide > 0
            ? "I didn't find a job you could get to yet."
            : "I didn't find a job that fits yet.",
        data: { jobs: [], blocked: blockedCount },
        action: { action: "navigate", target: "/career", label: "See the job board" },
        modelHint:
          `search_jobs returned no jobs. ${because} ` +
          "Say that plainly, name the reason, and offer one next step — a ride plan with their " +
          "instructor, a lower pay floor, or checking back when new jobs post. " +
          "Never invent a job, a company, or a wage.",
      };
    }

    const lines = shown
      .map((job) => {
        // The id tag tells the model which follow-up tool applies: explain_job
        // takes a jobListingId. A lead has no explain_job path yet, so it is
        // tagged with its own id and the hint says so, rather than handing the
        // model an id that would come back "not found".
        const idTag =
          job.kind === "listing"
            ? `[jobListingId=${job.jobListingId}]`
            : `[jobLeadId=${job.jobLeadId}]`;
        const kindNote = job.kind === "lead" ? " (a job your instructor lined up)" : "";
        return (
          `"${job.title}" at ${job.company}${kindNote} (${job.location})` +
          `${job.salary ? ` — ${job.salary}` : " — pay not listed"}. ` +
          `Reason: ${job.reason} ${idTag}`
        );
      })
      .join("\n");

    const blockedNote =
      blockedCount > 0
        ? ` ${blockedCount} other job${blockedCount === 1 ? " was" : "s were"} left out: ` +
          `${blockedForPay > 0 ? `${blockedForPay} paid under their floor` : ""}` +
          `${blockedForPay > 0 && blockedForRide > 0 ? ", " : ""}` +
          `${blockedForRide > 0 ? `${blockedForRide} had no way to get there` : ""}.`
        : "";

    return {
      status: "success",
      summary: `Found ${shown.length} job${shown.length === 1 ? "" : "s"} that fit you.`,
      data: { jobs: shown, blocked: blockedCount },
      modelHint:
        `Jobs from the student's own class board and the leads their instructor entered:\n${lines}\n` +
        `${blockedNote}\n` +
        "Name ONLY these jobs — do not invent a company, a title, a wage, or a posting that is " +
        "not in this list. Give each one its reason in your own plain words, then offer " +
        "explain_job for any entry tagged jobListingId. An entry tagged jobLeadId cannot be " +
        "explained by a tool yet — tell them to ask their instructor about it instead.",
    };
  },
};

// ─── explain_job ────────────────────────────────────────────────────────────

const EXPLAIN_SECTIONS = [
  "What you'd do",
  "Hours",
  "Pay",
  "Must-haves",
  "How you'd get there",
] as const;

const MISSING_FIELD_LINE = "The posting doesn't say.";

const EXPLAIN_SYSTEM_PROMPT = [
  "You rewrite one job posting so a student reading at a 6th-grade level understands it.",
  "",
  "Use EXACTLY these five sections, in this order, each on its own line:",
  ...EXPLAIN_SECTIONS.map((section) => `${section}:`),
  "",
  "Rules:",
  "- At most 2 sentences per section. Short words. Short sentences.",
  `- If the posting does not give you a fact for a section, write exactly: ${MISSING_FIELD_LINE}`,
  "- Never guess pay, hours, or requirements. Never add a benefit, a shift, or a duty that is",
  "  not in the posting.",
  '- "How you\'d get there" describes what the student already has and the one step that closes',
  "  the gap, using only the posting's own requirements. If the posting lists no requirements,",
  `  write: ${MISSING_FIELD_LINE}`,
  "- Write to the student as 'you'. No headings other than the five above, no bullet lists.",
].join("\n");

function explainGrounding(job: {
  title: string;
  company: string;
  location: string;
  salary: string | null;
  employmentType: string | null;
  description: string;
}): string {
  return [
    "JOB POSTING (the only facts you may use):",
    `Title: ${job.title}`,
    `Company: ${job.company}`,
    `Location: ${job.location}`,
    `Pay: ${job.salary ?? "not stated in the posting"}`,
    `Hours or job type: ${job.employmentType ?? "not stated in the posting"}`,
    `Description: ${job.description.slice(0, 2500) || "not stated in the posting"}`,
  ].join("\n");
}

const explainJob: AgentTool = {
  name: "explain_job",
  description:
    "Explain one job posting from the student's class board in plain words, using a fixed " +
    "layout: what you'd do, hours, pay, must-haves, and how you'd get there. Uses only what the " +
    "posting actually says. Read-only. Use the jobListingId from search_jobs or lookup_saved_jobs.",
  parameters: {
    type: "object",
    properties: {
      jobListingId: { type: "string", description: "The job listing's id." },
    },
    required: ["jobListingId"],
  },
  requiredRoles: ["student"],
  riskTier: "read",
  enabled: true,
  async execute(args, ctx): Promise<AgentToolResult> {
    const jobListingId = String(args.jobListingId ?? "");
    const studentId = ctx.session.id;

    const enrollment = await prisma.studentClassEnrollment.findFirst({
      where: { studentId, status: "active" },
      select: { classId: true },
    });
    if (!enrollment) {
      return { status: "error", summary: "I couldn't find your active class enrollment." };
    }

    // Same class scoping as gatherJobAndProfile / save_job: a posting on
    // another cohort's board is "not found", never explained.
    const job = await prisma.jobListing.findFirst({
      where: { id: jobListingId, classConfig: { classId: enrollment.classId } },
      select: {
        id: true,
        title: true,
        company: true,
        location: true,
        salary: true,
        employmentType: true,
        description: true,
      },
    });
    if (!job) {
      return { status: "error", summary: "That job wasn't found on your job board." };
    }

    // student_record: the explanation is written for one student inside their
    // own chat, so it follows the FERPA-local routing rule rather than the
    // posting's public status. The task is classified "draft" (prose) in
    // src/lib/ai/roles.ts.
    const baseProvider = await resolveAiProvider({
      studentId,
      task: "explain_job",
      sensitivity: "student_record",
    });
    const provider = withUsageLogging(baseProvider, {
      studentId,
      callSite: "sage_agent.explain_job",
    });

    const grounding = explainGrounding(job);
    const firstDraft = (
      await provider.generateResponse(EXPLAIN_SYSTEM_PROMPT, [
        { role: "user", content: `${grounding}\n\nWrite the five sections now.` },
      ])
    ).trim();

    let explanation = firstDraft;
    let retried = false;

    // One retry, never more: a second miss returns the better of the two
    // drafts with its real grade attached rather than looping on a model that
    // is not going to get shorter.
    if (
      firstDraft.length > 0 &&
      !assessReadability(firstDraft, { maxGrade: PLAIN_LANGUAGE_IDEAL_GRADE }).withinTarget
    ) {
      retried = true;
      const second = (
        await provider.generateResponse(EXPLAIN_SYSTEM_PROMPT, [
          { role: "user", content: `${grounding}\n\nWrite the five sections now.` },
          { role: "model", content: firstDraft },
          {
            role: "user",
            content:
              "That is too hard to read. Write it again with shorter words and shorter " +
              "sentences. Keep the same five sections and the same facts. Do not add anything " +
              `the posting does not say — use "${MISSING_FIELD_LINE}" instead.`,
          },
        ])
      ).trim();
      if (second.length > 0) explanation = second;
    }

    if (explanation.length === 0) {
      return {
        status: "error",
        summary: "I couldn't put that job into plain words just now.",
        modelHint:
          "explain_job got an empty reply from the model. Tell the student plainly and offer to " +
          "try again. Do NOT describe the job from memory.",
      };
    }

    const readability = assessReadability(explanation, {
      maxGrade: PLAIN_LANGUAGE_IDEAL_GRADE,
    });

    return {
      status: "success",
      summary: `Here's "${job.title}" at ${job.company} in plain words.`,
      data: {
        jobListingId: job.id,
        title: job.title,
        company: job.company,
        explanation,
        readability: {
          grade: readability.grade,
          withinTarget: readability.withinTarget,
          retried,
        },
      },
      modelHint:
        `Plain-language explanation of "${job.title}" at ${job.company}:\n${explanation}\n\n` +
        "Give this to the student as written, or shorter. Do not add facts to it — anything the " +
        `posting did not say must stay "${MISSING_FIELD_LINE}"`,
    };
  },
};

export const JOB_SEARCH_TOOLS: AgentTool[] = [searchJobs, explainJob];
