/**
 * Career grounding tools (Phase C): read-only CareerOneStop counseling
 * lookups — Skills Matcher, occupation profiles, wages, tools & technology,
 * and local training programs — so Sage's career coaching is grounded in real
 * labor-market data instead of model guesses.
 *
 * Every tool here is riskTier "read" (safe under readonly agent mode) and
 * wraps @/lib/career/careeronestop-counseling, which degrades gracefully when
 * COS_USER_ID / COS_API_TOKEN are absent. Locations default to WV — SPOKES
 * students are West Virginia based. Sibling career-tools.ts holds the
 * resume-editing and saved-job coaching tools; this file is external
 * labor-market data only.
 */

import {
  fetchOccupationProfile,
  fetchOccupationWages,
  fetchSkillsMatcherQuestions,
  fetchToolsAndTechnology,
  fetchTrainingPrograms,
  searchOccupations,
  submitSkillsMatcher,
  skillsMatcherAnswerSchema,
  type CounselingErrorCode,
  type WagePercentiles,
} from "@/lib/career/careeronestop-counseling";
import { z } from "zod";
import type { AgentTool, AgentToolResult } from "./types";

const ONET_CODE_PATTERN = /^\d{2}-\d{4}\.\d{2}$/;

// -----------------------------------------------------------------------------
// Shared result helpers
// -----------------------------------------------------------------------------

/** COS env keys absent — an expected deployment state, not a transient fault. */
function notConfiguredResult(): AgentToolResult {
  return {
    status: "error",
    summary: "Live career data isn't connected on this site yet.",
    modelHint:
      "The CareerOneStop connection isn't configured on this server, so you cannot pull live " +
      "career data (wages, occupations, training programs). Tell the user plainly that live " +
      "career numbers aren't available right now and suggest they ask their instructor. " +
      "Do NOT invent wages, job outlooks, or program names.",
  };
}

function serviceErrorResult(code: CounselingErrorCode): AgentToolResult {
  const summary =
    code === "timeout" || code === "network"
      ? "The career-data service didn't answer in time."
      : code === "unauthorized"
        ? "The career-data service turned down our request."
        : "The career-data service sent back something I couldn't read.";
  return {
    status: "error",
    summary,
    modelHint:
      `CareerOneStop lookup failed (${code}). Tell the user you couldn't reach the live ` +
      "career data right now and offer to try again in a bit. Do NOT invent numbers or " +
      "program names to fill the gap." +
      (code === "unauthorized"
        ? " If it keeps happening, the site's CareerOneStop credentials likely need attention — suggest they mention it to their instructor."
        : ""),
  };
}

/** "About $36,000 a year" / "about $17.50 an hour" — 6th-grade-friendly. */
function wageLine(entry: WagePercentiles): string | null {
  if (entry.median === null) return null;
  const hourly = entry.rateType?.toLowerCase().includes("hour");
  const amount = hourly
    ? `$${entry.median.toFixed(2)} an hour`
    : `$${Math.round(entry.median).toLocaleString("en-US")} a year`;
  return `${entry.areaName ?? "listed area"}: about ${amount} (typical/median)`;
}

// -----------------------------------------------------------------------------
// career_skills_match — CareerOneStop Skills Matcher (RIASEC-aligned)
// -----------------------------------------------------------------------------

const careerSkillsMatch: AgentTool = {
  name: "career_skills_match",
  description:
    "CareerOneStop Skills Matcher. Call with NO answers to get the self-rating skill questions " +
    "(ask the student a few at a time, rating 1-5). Call again WITH the collected answers to get " +
    "real occupations that fit their skills, with outlook and typical pay. Read-only.",
  parameters: {
    type: "object",
    properties: {
      answers: {
        type: "array",
        description:
          "The student's self-ratings so far: objects of {elementId, rating} where rating is " +
          "1 (just starting out) to 5 (expert). Omit to fetch the question list first.",
        items: { type: "object" },
      },
    },
  },
  requiredRoles: ["student", "teacher", "admin", "coordinator"],
  riskTier: "read",
  enabled: true,
  async execute(args): Promise<AgentToolResult> {
    const rawAnswers = args.answers;

    if (rawAnswers === undefined || (Array.isArray(rawAnswers) && rawAnswers.length === 0)) {
      const result = await fetchSkillsMatcherQuestions();
      if (!result.configured) return notConfiguredResult();
      if (result.error) return serviceErrorResult(result.error);

      return {
        status: "success",
        summary: `Loaded ${result.questions.length} skill questions.`,
        data: { questions: result.questions },
        modelHint:
          `Skills Matcher has ${result.questions.length} self-rating questions (each has an elementId). ` +
          "Ask the student to rate themselves in SMALL batches — about 5 questions at a time, in plain " +
          'language, on a 1-5 scale (1 = "just starting out", 5 = "expert"). Use each question\'s ' +
          "easyReadDescription when the wording is hard. Keep a running list of {elementId, rating} " +
          "and, when the student has rated enough (they can stop any time), call career_skills_match " +
          "again with the collected answers. Never rate FOR the student.",
      };
    }

    if (!Array.isArray(rawAnswers)) {
      return { status: "error", summary: "Answers must be a list of {elementId, rating}." };
    }
    const parsedAnswers = z.array(skillsMatcherAnswerSchema).min(1).max(60).safeParse(rawAnswers);
    if (!parsedAnswers.success) {
      return {
        status: "error",
        summary: "Some answers were malformed — each needs an elementId and a rating from 1 to 5.",
        modelHint:
          "The answers array didn't validate. Each entry must be {elementId: string, rating: integer 1-5}. " +
          "Re-check what you collected and call the tool again.",
      };
    }

    const result = await submitSkillsMatcher(parsedAnswers.data);
    if (!result.configured) return notConfiguredResult();
    if (result.error) return serviceErrorResult(result.error);
    if (result.matches.length === 0) {
      return {
        status: "success",
        summary: "No occupation matches came back for those ratings.",
        data: { matches: [] },
        modelHint:
          "Skills Matcher returned no matches. Tell the student plainly and offer to rate a few more " +
          "skills or explore careers by keyword with career_occupation_profile instead.",
      };
    }

    return {
      status: "success",
      summary: `Found ${result.matches.length} careers that fit those skills.`,
      data: { matches: result.matches },
      action: { action: "navigate", target: "/career", label: "Explore jobs" },
      modelHint:
        `Best-fit careers (rank order): ${result.matches
          .slice(0, 5)
          .map(
            (m) =>
              `${m.title} [onetCode=${m.onetCode}${m.typicalEducation ? `, usually needs ${m.typicalEducation}` : ""}${m.medianAnnualWage !== null ? `, ~$${Math.round(m.medianAnnualWage).toLocaleString("en-US")}/yr` : ""}]`,
          )
          .join("; ")}. ` +
        "Walk the student through the top 2-3 in plain, encouraging language — what the job is, what it " +
        "pays, what education it usually needs. Offer career_occupation_profile (pass the onetCode) for " +
        "a deeper look at any of them. Use ONLY the returned data; never invent numbers.",
    };
  },
};

// -----------------------------------------------------------------------------
// career_occupation_profile — what a job is really like
// -----------------------------------------------------------------------------

const careerOccupationProfile: AgentTool = {
  name: "career_occupation_profile",
  description:
    "Look up a real occupation profile from CareerOneStop — what the job is, typical daily tasks, " +
    "the education it usually needs, and typical pay for the student's area. Takes a job title " +
    "(e.g. 'nursing assistant') or an O*NET code (e.g. '31-1131.00'). Read-only.",
  parameters: {
    type: "object",
    properties: {
      occupation: {
        type: "string",
        description: "Job title keyword or O*NET code.",
      },
      location: {
        type: "string",
        description: "State, city+state, or ZIP for local wage data. Defaults to WV.",
      },
    },
    required: ["occupation"],
  },
  requiredRoles: ["student", "teacher", "admin", "coordinator"],
  riskTier: "read",
  enabled: true,
  async execute(args): Promise<AgentToolResult> {
    const occupation = String(args.occupation ?? "").trim();
    const location = String(args.location ?? "").trim() || undefined;
    if (!occupation) {
      return { status: "error", summary: "Tell me which job to look up." };
    }

    const result = await fetchOccupationProfile(occupation, { location });
    if (!result.configured) return notConfiguredResult();
    if (result.error === "not_found" || (!result.error && !result.profile)) {
      return {
        status: "success",
        summary: `I couldn't find an occupation matching "${occupation}".`,
        data: { profile: null },
        modelHint:
          `No occupation profile matched "${occupation}". Ask the student to describe the job ` +
          "differently (a more common title works best) rather than guessing.",
      };
    }
    if (result.error) return serviceErrorResult(result.error);
    const profile = result.profile!;

    const wageLines = profile.wages.map(wageLine).filter((line): line is string => line !== null);
    return {
      status: "success",
      summary: `Found the profile for ${profile.title}.`,
      data: { profile },
      action: { action: "navigate", target: "/career", label: "Browse related jobs" },
      modelHint:
        `Occupation: ${profile.title}${profile.onetCode ? ` [onetCode=${profile.onetCode}]` : ""}. ` +
        (profile.description ? `What they do: ${profile.description} ` : "") +
        (profile.typicalEducation ? `Usually needs: ${profile.typicalEducation}. ` : "") +
        (profile.brightOutlook ? `Outlook: ${profile.brightOutlook}. ` : "") +
        (profile.tasks.length ? `Daily tasks include: ${profile.tasks.join("; ")}. ` : "") +
        (wageLines.length
          ? `Pay (median = half earn more, half earn less)${profile.wageYear ? ` (${profile.wageYear} data)` : ""}: ${wageLines.slice(0, 3).join("; ")}. `
          : "No wage data came back. ") +
        "Explain this to the student at a 6th-grade reading level — plain words, short sentences. " +
        "Use ONLY these facts. Offer career_training_programs to find local training, or " +
        "career_tools_technology (pass the onetCode) for what tools they'd use on the job.",
    };
  },
};

// -----------------------------------------------------------------------------
// career_wages — typical pay, local first
// -----------------------------------------------------------------------------

const careerWages: AgentTool = {
  name: "career_wages",
  description:
    "Look up real wage data for an occupation from CareerOneStop — the typical (median) pay plus " +
    "the low-to-high range, local area first. Takes a job title or O*NET code. Read-only.",
  parameters: {
    type: "object",
    properties: {
      occupation: {
        type: "string",
        description: "Job title keyword or O*NET code.",
      },
      location: {
        type: "string",
        description: "State, city+state, or ZIP. Defaults to WV.",
      },
    },
    required: ["occupation"],
  },
  requiredRoles: ["student", "teacher", "admin", "coordinator"],
  riskTier: "read",
  enabled: true,
  async execute(args): Promise<AgentToolResult> {
    const occupation = String(args.occupation ?? "").trim();
    const location = String(args.location ?? "").trim() || undefined;
    if (!occupation) {
      return { status: "error", summary: "Tell me which job's pay to look up." };
    }

    const result = await fetchOccupationWages(occupation, { location });
    if (!result.configured) return notConfiguredResult();
    if (result.error) return serviceErrorResult(result.error);
    if (result.wages.length === 0) {
      return {
        status: "success",
        summary: `No wage data came back for "${occupation}".`,
        data: { wages: [] },
        modelHint:
          `CareerOneStop had no wage rows for "${occupation}". Tell the student plainly; a more ` +
          "common job title may work better. Never invent pay numbers.",
      };
    }

    const wageLines = result.wages.map(wageLine).filter((line): line is string => line !== null);
    return {
      status: "success",
      summary: `Found pay data for ${result.occupationTitle ?? occupation}.`,
      data: {
        occupationTitle: result.occupationTitle,
        onetCode: result.onetCode,
        wageYear: result.wageYear,
        wages: result.wages,
      },
      modelHint:
        `Pay for ${result.occupationTitle ?? occupation}${result.wageYear ? ` (${result.wageYear} data)` : ""}: ` +
        `${wageLines.slice(0, 4).join("; ")}. ` +
        "Percentiles are in the data (pct10 = starting-out pay, pct90 = experienced top earners). " +
        'Explain simply: "median" means half of workers earn more and half earn less. Lead with the ' +
        "local (state) number, mention the national one for comparison. Use ONLY these numbers.",
    };
  },
};

// -----------------------------------------------------------------------------
// career_training_programs — local education & training finder
// -----------------------------------------------------------------------------

const careerTrainingPrograms: AgentTool = {
  name: "career_training_programs",
  description:
    "Find real local education and training programs for an occupation or field via CareerOneStop's " +
    "Training Finder — school, program name, credential earned, and where it is. Read-only.",
  parameters: {
    type: "object",
    properties: {
      occupation: {
        type: "string",
        description: "Occupation or field keyword (e.g. 'welding', 'medical assistant').",
      },
      location: {
        type: "string",
        description: "State, city+state, or ZIP to search near. Defaults to WV.",
      },
      limit: {
        type: "integer",
        description: "How many programs to return (default 5, max 10).",
      },
    },
    required: ["occupation"],
  },
  requiredRoles: ["student", "teacher", "admin", "coordinator"],
  riskTier: "read",
  enabled: true,
  async execute(args): Promise<AgentToolResult> {
    const occupation = String(args.occupation ?? "").trim();
    const location = String(args.location ?? "").trim() || undefined;
    const limit = Math.min(Math.max(Number(args.limit) || 5, 1), 10);
    if (!occupation) {
      return { status: "error", summary: "Tell me what kind of training to look for." };
    }

    const result = await fetchTrainingPrograms(occupation, { location, limit });
    if (!result.configured) return notConfiguredResult();
    if (result.error) return serviceErrorResult(result.error);
    if (result.programs.length === 0) {
      return {
        status: "success",
        summary: `No training programs found for "${occupation}" near ${location ?? "WV"}.`,
        data: { programs: [], totalCount: 0 },
        modelHint:
          "No programs came back. Tell the student plainly and suggest trying a broader keyword or a " +
          "nearby city. Also remind them their SPOKES certifications may already cover some ground. " +
          "Never invent schools or programs.",
      };
    }

    return {
      status: "success",
      summary: `Found ${result.programs.length} training program${result.programs.length === 1 ? "" : "s"} for "${occupation}".`,
      data: { programs: result.programs, totalCount: result.totalCount },
      modelHint:
        `Training programs (${result.totalCount} total found): ${result.programs
          .map(
            (p) =>
              `${p.program ?? "Program"} at ${p.school}${p.city ? ` (${p.city}${p.state ? `, ${p.state}` : ""})` : ""}${p.credential ? ` — earns ${p.credential}` : ""}${p.distanceMiles !== null ? `, ~${Math.round(p.distanceMiles)} mi away` : ""}`,
          )
          .join("; ")}. ` +
        "Walk the student through the closest 2-3 in plain language: what they'd earn a credential in " +
        "and where. Program URLs are in the data if they want a link. Suggest they talk with their " +
        "instructor before committing to anything — cost and funding matter and aren't shown here.",
    };
  },
};

// -----------------------------------------------------------------------------
// career_tools_technology — what you'd actually use on the job
// -----------------------------------------------------------------------------

const careerToolsTechnology: AgentTool = {
  name: "career_tools_technology",
  description:
    "List the real tools and technology used in an occupation (from CareerOneStop/O*NET) — " +
    "equipment, machines, and software. Takes a job title or O*NET code. Read-only.",
  parameters: {
    type: "object",
    properties: {
      occupation: {
        type: "string",
        description: "Job title keyword or O*NET code (e.g. '29-1141.00').",
      },
    },
    required: ["occupation"],
  },
  requiredRoles: ["student", "teacher", "admin", "coordinator"],
  riskTier: "read",
  enabled: true,
  async execute(args): Promise<AgentToolResult> {
    const occupation = String(args.occupation ?? "").trim();
    if (!occupation) {
      return { status: "error", summary: "Tell me which job to look up tools for." };
    }

    // The techtool endpoint needs an O*NET code — resolve titles first.
    let onetCode = occupation;
    if (!ONET_CODE_PATTERN.test(occupation)) {
      const search = await searchOccupations(occupation, { limit: 1 });
      if (!search.configured) return notConfiguredResult();
      if (search.error) return serviceErrorResult(search.error);
      if (search.occupations.length === 0) {
        return {
          status: "success",
          summary: `I couldn't find an occupation matching "${occupation}".`,
          data: { tools: [], technology: [] },
          modelHint:
            `No occupation matched "${occupation}", so no tools list is available. Ask the student ` +
            "for a more common job title rather than guessing.",
        };
      }
      onetCode = search.occupations[0].onetCode;
    }

    const result = await fetchToolsAndTechnology(onetCode);
    if (!result.configured) return notConfiguredResult();
    if (result.error) return serviceErrorResult(result.error);
    if (result.tools.length === 0 && result.technology.length === 0) {
      return {
        status: "success",
        summary: `No tools or technology data came back for "${occupation}".`,
        data: { tools: [], technology: [] },
        modelHint:
          "The tools/technology list was empty for this occupation. Tell the student plainly and " +
          "offer career_occupation_profile for the bigger picture instead.",
      };
    }

    const describe = (categories: typeof result.tools): string =>
      categories.map((c) => `${c.category} (${c.examples.join(", ")})`).join("; ");

    return {
      status: "success",
      summary: `Found the tools and technology for ${result.occupationTitle ?? occupation}.`,
      data: {
        onetCode: result.onetCode,
        occupationTitle: result.occupationTitle,
        tools: result.tools,
        technology: result.technology,
      },
      modelHint:
        `On the job as ${result.occupationTitle ?? occupation}, people use — ` +
        (result.tools.length ? `Tools/equipment: ${describe(result.tools)}. ` : "") +
        (result.technology.length ? `Software/technology: ${describe(result.technology)}. ` : "") +
        "Share the highlights in plain language and connect them to things the student already knows " +
        "(phones, registers, common software). If any match a SPOKES certification or platform, point " +
        "that out as a head start.",
    };
  },
};

export const CAREER_GROUNDING_TOOLS: AgentTool[] = [
  careerSkillsMatch,
  careerOccupationProfile,
  careerWages,
  careerTrainingPrograms,
  careerToolsTechnology,
];
