/**
 * Assessment write tools: student-reported career assessment results.
 *
 * The owner has no CareerOneStop API credentials yet, so students take the
 * free assessments themselves (Skills Matcher at
 * careeronestop.org/toolkit/skills/skills-matcher.aspx, O*NET Interest
 * Profiler, ...) and report the results to Sage. record_assessment_results
 * persists them onto CareerDiscovery with provenance
 * (profileSource="student_reported_cos") after an HMAC confirm-card
 * round-trip, so an assessed profile displaces the LLM-inferred RIASEC
 * scores that otherwise drive Career DNA, the learning pathway, and job
 * matching.
 *
 * Future-proofing: the persistence helper
 * (recordAssessedCareerProfile in @/lib/career-discovery) takes the source as
 * a parameter — when COS credentials exist, the live API path writes the same
 * row with source "cos_api" instead of adding a second pipeline.
 *
 * Follows the write-tools.ts contract exactly: ownership (own row only),
 * confirmation (confirmationGate), ledger (executeAndLedger → SageOperation +
 * AuditLog).
 */

import { z } from "zod";
import { recordAssessedCareerProfile } from "@/lib/career-discovery";
import type { RiasecScores } from "@/lib/sage/discovery-extractor";
import { confirmationGate, executeAndLedger } from "./write-tools";
import type { AgentTool, AgentToolResult } from "./types";

const INSTRUMENTS = ["careeronestop-skills-matcher", "onet-interest-profiler", "other"] as const;

const INSTRUMENT_LABELS: Record<string, string> = {
  "careeronestop-skills-matcher": "CareerOneStop Skills Matcher",
  "onet-interest-profiler": "O*NET Interest Profiler",
};

/** SOC / O*NET code, e.g. "51-4121" or "51-4121.00". */
const SOC_PATTERN = /^\d{2}-\d{4}(\.\d{2})?$/;

const scoreSchema = z
  .number()
  .min(0, "Scores go from 0 to 1.")
  .max(1, "Scores go from 0 to 1.");

const riasecSchema = z
  .object({
    realistic: scoreSchema.optional(),
    investigative: scoreSchema.optional(),
    artistic: scoreSchema.optional(),
    social: scoreSchema.optional(),
    enterprising: scoreSchema.optional(),
    conventional: scoreSchema.optional(),
  })
  .strict()
  .refine((scores) => Object.values(scores).some((value) => value !== undefined), {
    message: "riasec needs at least one scored dimension.",
  });

const occupationSchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    soc: z
      .string()
      .trim()
      .regex(SOC_PATTERN, 'soc must look like "51-4121.00".')
      .optional(),
  })
  .strict();

const argsSchema = z
  .object({
    instrument: z.enum(INSTRUMENTS),
    instrumentName: z.string().trim().min(1).max(120).optional(),
    riasec: riasecSchema.optional(),
    topOccupations: z.array(occupationSchema).min(1).max(10).optional(),
    notes: z.string().trim().min(1).max(2000).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.instrument === "other" && !value.instrumentName) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'instrumentName is required when instrument is "other".',
        path: ["instrumentName"],
      });
    }
    if (!value.riasec && !value.topOccupations && !value.notes) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Nothing to save — include riasec scores, topOccupations, or notes.",
      });
    }
  });

type ParsedArgs = z.infer<typeof argsSchema>;

/**
 * Deterministic normalized args for the confirm-card round-trip: only defined
 * keys, trimmed strings, no undefined values. The HMAC token is minted over
 * this object and the card replays it verbatim, so normalization must be
 * idempotent (normalize(normalize(x)) === normalize(x)).
 */
function normalizeArgs(parsed: ParsedArgs): Record<string, unknown> {
  const normalized: Record<string, unknown> = { instrument: parsed.instrument };
  if (parsed.instrumentName !== undefined) normalized.instrumentName = parsed.instrumentName;
  if (parsed.riasec !== undefined) {
    normalized.riasec = Object.fromEntries(
      Object.entries(parsed.riasec).filter(([, value]) => value !== undefined),
    );
  }
  if (parsed.topOccupations !== undefined) {
    normalized.topOccupations = parsed.topOccupations.map((occupation) =>
      occupation.soc !== undefined
        ? { title: occupation.title, soc: occupation.soc }
        : { title: occupation.title },
    );
  }
  if (parsed.notes !== undefined) normalized.notes = parsed.notes;
  return normalized;
}

function instrumentLabel(parsed: ParsedArgs): string {
  return parsed.instrument === "other"
    ? (parsed.instrumentName ?? "assessment")
    : INSTRUMENT_LABELS[parsed.instrument];
}

/** Plain-language confirm-card text: exactly what will be saved. */
function proposalSummary(parsed: ParsedArgs): string {
  const parts = [`Save your ${instrumentLabel(parsed)} results?`];
  if (parsed.riasec) {
    parts.push("Your interest scores will update to match them.");
  }
  if (parsed.topOccupations && parsed.topOccupations.length > 0) {
    const titles = parsed.topOccupations.slice(0, 3).map((occupation) => occupation.title);
    parts.push(`Top matches: ${titles.join(", ")}.`);
  }
  return parts.join(" ");
}

const recordAssessmentResults: AgentTool = {
  name: "record_assessment_results",
  description:
    "Save career assessment results the student took on their own (CareerOneStop Skills Matcher, " +
    "O*NET Interest Profiler, or another instrument) to their Career DNA, with provenance. " +
    "Collect what they report — interest scores (0 to 1 per RIASEC dimension), top occupation " +
    "matches, notes — and pass it here. Requires user confirmation.",
  parameters: {
    type: "object",
    properties: {
      instrument: {
        type: "string",
        enum: INSTRUMENTS,
        description: "Which assessment the student took.",
      },
      instrumentName: {
        type: "string",
        description: 'The assessment\'s name — required when instrument is "other".',
      },
      riasec: {
        type: "object",
        description:
          "Reported RIASEC scores, 0 to 1 per dimension (realistic, investigative, artistic, " +
          "social, enterprising, conventional). Include only dimensions the student reported.",
      },
      topOccupations: {
        type: "array",
        description:
          "Top occupation matches the assessment reported: objects of {title, soc?} where soc " +
          'is the SOC/O*NET code like "51-4121.00" if the student has it.',
        items: { type: "object" },
      },
      notes: {
        type: "string",
        description: "Anything else the student reported about their results, in their words.",
      },
    },
    required: ["instrument"],
  },
  // Self-report of the student's own results — student-only, like the other
  // self-report write tools (mark_certification_complete et al.).
  requiredRoles: ["student"],
  riskTier: "mutate_consequential",
  enabled: true,
  async execute(args, ctx): Promise<AgentToolResult> {
    const parsedArgs = argsSchema.safeParse(args);
    if (!parsedArgs.success) {
      const issue = parsedArgs.error.issues[0];
      return {
        status: "error",
        summary: "Those results didn't validate, so nothing was saved.",
        modelHint:
          `record_assessment_results rejected the arguments: ${issue?.message ?? "invalid input"}. ` +
          "Re-check what the student reported and call the tool again with valid values. " +
          "Never guess or fill in scores the student did not give you.",
      };
    }
    const parsed = parsedArgs.data;
    const studentId = ctx.session.id;
    const normalized = normalizeArgs(parsed);
    const label = instrumentLabel(parsed);

    const gate = await confirmationGate(
      "record_assessment_results",
      normalized,
      ctx,
      proposalSummary(parsed),
      "Save my results",
    );
    if (gate) return gate;

    return executeAndLedger("record_assessment_results", normalized, ctx, async () => {
      await recordAssessedCareerProfile({
        studentId,
        source: "student_reported_cos",
        assessedAt: new Date(),
        payload: normalized as never,
        riasec: parsed.riasec as Partial<RiasecScores> | undefined,
      });

      const scoreNote = parsed.riasec
        ? " Your interest scores now come from this test, not from chat."
        : "";
      return {
        summary: `Saved — your ${label} results are now part of your Career DNA.${scoreNote}`,
        data: { profileSource: "student_reported_cos", instrument: parsed.instrument },
      };
    });
  },
};

export const ASSESSMENT_TOOLS: AgentTool[] = [recordAssessmentResults];
