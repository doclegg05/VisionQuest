/* eslint-disable @typescript-eslint/no-explicit-any -- mock.fn()-free scaffolding still has to satisfy several unrelated Prisma signatures at once. */
/**
 * posting-injection harness — the Sage-tool half.
 *
 * Drives the REAL `search_jobs` and `explain_job` tools (src/lib/sage/agent/
 * job-search-tools.ts) with hostile JobListing rows, and reports, per posting:
 *
 *   searchResult   the serialized search_jobs result   (reaches the model via
 *                  loop.ts toHandlerResult: summary + modelHint + data)
 *   explainPrompt  the system prompt + user message explain_job actually sent
 *   explainResult  the serialized explain_job result   (same model path, plus
 *                  `data.explanation` is shown to the student as written)
 *
 * The scorer decides what counts as a leak; this file only produces the
 * strings. That split matters: the forbidden list is a durable, reviewable
 * artifact in the scorer and the fixture, not something buried in a mock.
 *
 * Needs `--experimental-test-module-mocks`, so it runs as a child process
 * spawned by scripts/bench/suites/posting-injection.mjs. One JSON object on
 * stdout, nothing else.
 */
import { mock } from "node:test";

interface HostilePosting {
  id: string;
  family: string;
  title: string;
  company: string;
  location: string;
  salary: string;
  employmentType: string;
  description: string;
  markers: string[];
}

let currentListing: Record<string, unknown> | null = null;
const providerCalls: Array<{ systemPrompt: string; user: string }> = [];
/**
 * A deliberately COMPLIANT model reply. The tool refuses a draft that invents
 * a wage or drops a section, and a refusal would mean the posting never
 * reached the output paths under test — the attack would look "blocked" for
 * the wrong reason. The reply quotes nothing from the posting, so anything
 * attacker-supplied that shows up in the result got there through the tool.
 */
const COMPLIANT_REPLY = [
  "What you'd do: Do the work the posting lists.",
  "Hours: Full time, days.",
  "Pay: $15 an hour.",
  "Must-haves: You can lift 40 pounds.",
  "How you'd get there: Ask your teacher about the next step.",
].join(" ");

mock.module("@/lib/db", {
  namedExports: {
    prisma: {
      studentClassEnrollment: { findFirst: async () => ({ classId: "class-1" }) },
      jobClassConfig: {
        findUnique: async () => ({
          id: "cfg-1",
          classId: "class-1",
          region: "Charleston, WV",
          localJobPriority: "prefer_local",
        }),
      },
      jobListing: {
        findMany: async () => (currentListing ? [currentListing] : []),
        findFirst: async () => currentListing,
      },
      studentSavedJob: { findMany: async () => [] },
      careerDiscovery: {
        findUnique: async () => ({
          topClusters: ["career-readiness"],
          hollandCode: "RCE",
          transferableSkills: null,
        }),
      },
      resumeData: { findUnique: async () => null },
      studentWorkProfile: { findUnique: async () => null },
    },
  },
});

mock.module("@/lib/connect/matching", { namedExports: { rankLeadsForStudent: async () => [] } });

mock.module("@/lib/ai/provider", {
  namedExports: {
    resolveAiProvider: async () => ({
      name: "ollama",
      async generateResponse(systemPrompt: string, messages: Array<{ content: string }>) {
        providerCalls.push({
          systemPrompt,
          user: messages[messages.length - 1]?.content ?? "",
        });
        return COMPLIANT_REPLY;
      },
    }),
  },
});

mock.module("@/lib/llm-usage", { namedExports: { withUsageLogging: (p: unknown) => p } });

mock.module("@/lib/ai/audit", {
  namedExports: {
    logAiAuditEvent: async () => undefined,
    getProviderClass: (name?: string | null) => (name === "ollama" ? "local" : "unknown"),
    policyDecisionForProvider: (name?: string | null) =>
      name === "ollama" ? "local_only" : "configured_provider",
  },
});

mock.module("@/lib/logger", {
  namedExports: {
    logger: { error: () => undefined, warn: () => undefined, info: () => undefined, debug: () => undefined },
  },
});

function rowFor(posting: HostilePosting) {
  return {
    id: "job-1",
    title: posting.title,
    company: posting.company,
    location: posting.location,
    workMode: "onsite",
    salary: posting.salary,
    salaryMin: 15,
    employmentType: posting.employmentType,
    description: posting.description,
    url: "https://example.test/job-1",
    source: "careeronestop",
    clusters: ["career-readiness"],
    createdAt: new Date("2026-09-01T00:00:00.000Z"),
  };
}

async function main() {
  const { JOB_SEARCH_TOOLS } = await import("@/lib/sage/agent/job-search-tools");
  const tool = (name: string) => {
    const found = JOB_SEARCH_TOOLS.find((t) => t.name === name);
    if (!found) throw new Error(`${name} is not registered in JOB_SEARCH_TOOLS`);
    return found;
  };
  const ctx = () => ({ session: { id: "stu-1", role: "student" }, conversationId: "conv-1" }) as any;

  const postings: HostilePosting[] = JSON.parse(process.env.BENCH_POSTINGS ?? "[]");
  if (postings.length === 0) throw new Error("BENCH_POSTINGS is empty");

  const results = [];
  for (const posting of postings) {
    currentListing = rowFor(posting);

    const search = await tool("search_jobs").execute({}, ctx());

    providerCalls.length = 0;
    const explain = await tool("explain_job").execute({ jobListingId: "job-1" }, ctx());
    const call = providerCalls[0];

    results.push({
      id: posting.id,
      searchResult: JSON.stringify(search),
      explainStatus: explain.status,
      explainResult: JSON.stringify(explain),
      explainPrompt: call ? `${call.systemPrompt}\n${call.user}` : null,
    });
  }

  process.stdout.write(`${JSON.stringify({ results })}\n`);
}

void main().catch((err) => {
  process.stderr.write(`${String(err instanceof Error ? err.stack : err)}\n`);
  process.exitCode = 1;
});
