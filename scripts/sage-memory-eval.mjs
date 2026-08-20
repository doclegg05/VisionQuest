#!/usr/bin/env node

/**
 * Sage memory eval (Phase 2 acceptance).
 *
 * Replays synthetic scripted conversations for sentinel test subjects through
 * the REAL extract -> store -> retrieve pipeline (live model + dev DB), then
 * reports:
 *   - duplicate-fact rate: % of stored memories whose embedding is >= 0.92
 *     cosine-similar to an earlier stored memory for the same subject
 *     (gate: < 5%)
 *   - retrieval hit rate: % of probe queries whose expected fact surfaces
 *     in retrieveMemories() results (gate: >= 90%)
 *
 * Three suites, all measured against the same two bars:
 *   1. STUDENT   — 20 chat conversations. Conversations 16-20 deliberately
 *                  restate facts from 1-5 in different wording (dedupe stress).
 *   2. STAFF     — 5 instructor chats through extractAndStoreStaffMemories,
 *                  producing teacher-subject memories.
 *   3. OPERATION — 3 deterministic teacher actions (goal confirmation, cert
 *                  verification, discovery override) through the templated
 *                  operation-memory writers. No model call.
 *
 * The staff suite also reports two privacy checks that the two headline gates
 * cannot see: no teacher-subject memory may carry student-identifying content,
 * and a staff conversation may never write a student-subject row.
 *
 * Usage: npm run sage:memory:eval                       (Gemini, the default)
 *        npm run sage:memory:eval -- --provider=ollama  (local model)
 *        add --keep to skip cleanup
 */

import { loadEnvFile } from "./lib/sage-rag-utils.mjs";
import { resolveEvalProvider } from "./lib/sage-eval-provider.mjs";

loadEnvFile();

const EVAL_STUDENT_ID = "sage-memory-eval-student";
const EVAL_STAFF_ID = "sage-memory-eval-teacher";
const KEEP = process.argv.includes("--keep");
const DUP_SIMILARITY = 0.92;

// [facts conveyed, probe query, expected keyword in a retrieved memory]
const CONVERSATIONS = [
  { user: "I want to become a certified nursing assistant. My aunt was a CNA and I loved hearing about her work.", probe: "career goals", expect: ["nursing", "cna"] },
  { user: "I don't have a car, so I take the bus everywhere. Morning classes before 10 are really hard for me.", probe: "schedule and transportation", expect: ["bus", "public transport", "transit", "no car", "does not have a car"] },
  { user: "I have two kids in elementary school, so I need to be done by 2:30 to pick them up.", probe: "family circumstances", expect: ["kids", "children", "child", "school pickup", "pickup"] },
  { user: "I'm pretty good with computers already — I used Excel a lot at my old warehouse job.", probe: "computer skills", expect: ["excel", "computer"] },
  { user: "Reading long documents is tough for me. I learn way better from videos and doing things hands-on.", probe: "learning style", expect: ["hands-on", "video", "practice"] },
  { user: "I get really nervous before tests. Last time I almost didn't show up for the practice exam.", probe: "test anxiety", expect: ["nervous", "anxiety", "anxious"] },
  { user: "My goal this month is to finish the Khan Academy math section.", probe: "monthly goals", expect: ["khan"] },
  { user: "I worked at Dollar General for three years as a shift lead before this program.", probe: "work history", expect: ["dollar general", "shift lead", "retail"] },
  { user: "I really want to work at the hospital in Beckley once I'm certified.", probe: "where they want to work", expect: ["beckley", "hospital"] },
  { user: "When you give me one small task at a time it works way better than a big list.", probe: "coaching approach", expect: ["small", "one task", "single task", "step at a time", "task at a time"] },
  { user: "I passed my WorkKeys practice test yesterday with a silver score!", probe: "test progress", expect: ["workkeys", "silver"] },
  { user: "Math is my weakest subject, fractions especially give me trouble.", probe: "academic struggles", expect: ["math", "fraction"] },
  { user: "I prefer texting over email — I check my phone way more often.", probe: "communication preference", expect: ["text", "sms"] },
  { user: "My sister watches the kids on Tuesdays and Thursdays so those are my best study days.", probe: "best days to study", expect: ["tuesday", "sister"] },
  { user: "I finished the Bring Your A Game course last week and got the certificate.", probe: "completed certifications", expect: ["a game", "certificate"] },
  // Duplicate stress: restatements of conversations 1-5 in new wording.
  { user: "Like I said before, being a CNA is the dream. Nursing assistant work is what I'm here for.", probe: "career goals", expect: ["nursing", "cna"], duplicateOf: 0 },
  { user: "Just a reminder that I ride the bus, so early morning stuff doesn't work for me.", probe: "transportation", expect: ["bus", "public transport", "transit", "no car", "does not have a car"], duplicateOf: 1 },
  { user: "Remember I've got my two kids to pick up from school at 2:30 every day.", probe: "family circumstances", expect: ["kids", "children", "child", "school pickup", "pickup"], duplicateOf: 2 },
  { user: "I told you I know Excel pretty well from the warehouse job, right?", probe: "computer skills", expect: ["excel", "computer"], duplicateOf: 3 },
  { user: "Videos and practice work best for me — long reading just doesn't stick.", probe: "learning style", expect: ["video", "hands-on", "practice"], duplicateOf: 4 },
];

/**
 * Staff chats. Each one mixes a genuine working-preference fact with student
 * talk, because that is what a real instructor turn looks like — the extractor
 * has to pick out the former without carrying the latter across.
 */
const STAFF_CONVERSATIONS = [
  {
    user: "Keep answers to three bullets with the action first — I read these standing up between classes.",
    probe: "how to format answers for this instructor",
    expect: ["bullet", "short", "brief", "action first", "concise"],
  },
  {
    user: "I do my whole review pass first thing Monday morning, before the room fills up. Don't send me anything mid-week.",
    probe: "when this instructor reviews their caseload",
    expect: ["monday", "review", "morning", "weekly"],
  },
  {
    user: "I can't approve a placement on my own — that has to go to the coordinator every time.",
    probe: "what this instructor is allowed to decide",
    expect: ["coordinator", "approve", "placement", "cannot", "not allowed", "escalate"],
  },
  {
    user: "Give me the plain wording, not program jargon. Half my folks read at a sixth grade level and I just repeat what you tell me.",
    probe: "reading level and vocabulary preference",
    expect: ["plain", "jargon", "simple", "reading level", "grade"],
  },
  {
    user: "I open the intervention queue before anything else. That's my whole morning routine.",
    probe: "which screen this instructor opens first",
    expect: ["queue", "intervention", "first", "routine", "morning"],
  },
];

/**
 * Deterministic teacher actions. These bypass the model entirely — the eval's
 * job here is to prove the templated write lands and is retrievable, and that
 * three template-shaped sentences do not read as duplicates of each other.
 */
const OPERATION_EVENTS = [
  {
    label: "goal confirmation",
    probe: "goals a teacher has confirmed",
    expect: ["confirmed", "goal"],
    run: (ops) =>
      ops.recordGoalConfirmationMemory({
        studentId: EVAL_STUDENT_ID,
        goalId: "eval-goal-1",
        level: "weekly",
        content: "Finish the Khan Academy math section",
        at: new Date("2026-08-18T12:00:00Z"),
      }),
  },
  {
    label: "cert verification",
    probe: "certification requirements a teacher verified",
    expect: ["verified", "certification"],
    run: (ops) =>
      ops.recordCertVerificationMemory({
        studentId: EVAL_STUDENT_ID,
        requirementId: "eval-req-1",
        requirementLabel: "Course completion",
        certLabel: "Bring Your A Game",
        at: new Date("2026-08-19T12:00:00Z"),
      }),
  },
  {
    label: "discovery override",
    probe: "career discovery completion",
    expect: ["discovery", "career cluster"],
    run: (ops) =>
      ops.recordDiscoveryOverrideMemory({
        studentId: EVAL_STUDENT_ID,
        clusterLabel: "Healthcare Support",
        at: new Date("2026-08-20T12:00:00Z"),
      }),
  },
];

function cosineSimilarity(a, b) {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Pure exit-code decision for the memory eval gates — extracted so it can be
 * exercised with synthetic inputs (mocked duplicateRate/hitRate) without
 * running the live extract -> store -> retrieve pipeline.
 *
 * Gates:
 *   - duplicate-fact rate >= 5%  (unchanged — the original gate)
 *   - retrieval hit rate  < 90%  (new — mirrors the printed PASS bar above)
 */
export function computeMemoryEvalExitCode({ duplicateRate, hitRate }) {
  if (duplicateRate >= 0.05) return 1;
  if (hitRate < 0.9) return 1;
  return 0;
}

/** Near-duplicate count within one subject's stored rows, oldest first. */
function countDuplicates(rows) {
  const vectors = rows.map((row) => JSON.parse(row.vec));
  let duplicates = 0;
  const pairs = [];
  for (let i = 1; i < vectors.length; i++) {
    for (let j = 0; j < i; j++) {
      if (cosineSimilarity(vectors[i], vectors[j]) >= DUP_SIMILARITY) {
        duplicates++;
        pairs.push([rows[j].content, rows[i].content]);
        break;
      }
    }
  }
  return { duplicates, pairs };
}

async function loadRows(prisma, subjectType, subjectId) {
  return prisma.$queryRawUnsafe(
    `SELECT id, content, embedding::text AS vec, "createdAt"
     FROM "visionquest"."SageMemory"
     WHERE "subjectType" = $1 AND "subjectId" = $2 AND "validTo" IS NULL AND embedding IS NOT NULL
     ORDER BY "createdAt" ASC`,
    subjectType,
    subjectId,
  );
}

/** Probe a subject and report whether any expected keyword surfaced. */
async function probeHit(retrieveMemories, subjectType, subjectId, scenario) {
  const retrieved = await retrieveMemories(subjectType, subjectId, scenario.probe);
  return retrieved.some((memory) =>
    scenario.expect.some((keyword) => memory.content.toLowerCase().includes(keyword.toLowerCase())),
  );
}

async function main() {
  const { prisma } = await import("../src/lib/db.ts");
  const { extractAndStoreMemories } = await import("../src/lib/sage/memory/extract.ts");
  const { extractAndStoreStaffMemories } = await import("../src/lib/sage/memory/staff-extract.ts");
  const { retrieveMemories } = await import("../src/lib/sage/memory/retrieve.ts");
  const { looksLikeStudentReference } = await import("../src/lib/sage/memory/staff-privacy.ts");
  const ops = await import("../src/lib/sage/memory/operation-memory.ts");

  // Clean slate for both sentinel subjects.
  await prisma.sageMemory.deleteMany({
    where: {
      OR: [
        { subjectType: "student", subjectId: EVAL_STUDENT_ID },
        { subjectType: "teacher", subjectId: EVAL_STAFF_ID },
      ],
    },
  });

  const { provider, label: providerLabel } = await resolveEvalProvider();
  console.log(`Provider: ${providerLabel}`);
  const totals = { stored: 0, deduped: 0, rejected: 0 };

  console.log(`\nSuite 1/3 — replaying ${CONVERSATIONS.length} student conversations…`);
  for (const [index, conversation] of CONVERSATIONS.entries()) {
    const result = await extractAndStoreMemories({
      provider,
      studentId: EVAL_STUDENT_ID,
      conversationId: `eval-conv-${index}`,
      messages: [
        { role: "user", content: conversation.user },
        { role: "model", content: "Thanks for sharing that — noted. Let's keep going." },
      ],
    });
    totals.stored += result.stored;
    totals.deduped += result.deduped;
    totals.rejected += result.rejected;
    console.log(
      `[${index + 1}/${CONVERSATIONS.length}] stored=${result.stored} deduped=${result.deduped} rejected=${result.rejected}${"duplicateOf" in conversation ? " (restatement)" : ""}`,
    );
  }

  console.log(`\nSuite 2/3 — replaying ${STAFF_CONVERSATIONS.length} staff conversations…`);
  const staffTotals = { stored: 0, deduped: 0, rejected: 0 };
  for (const [index, conversation] of STAFF_CONVERSATIONS.entries()) {
    const result = await extractAndStoreStaffMemories({
      provider,
      staffId: EVAL_STAFF_ID,
      staffRole: "teacher",
      conversationId: `eval-staff-conv-${index}`,
      messages: [
        { role: "user", content: conversation.user },
        { role: "model", content: "Got it — I'll work that way." },
      ],
    });
    staffTotals.stored += result.stored;
    staffTotals.deduped += result.deduped;
    staffTotals.rejected += result.rejected;
    console.log(
      `[${index + 1}/${STAFF_CONVERSATIONS.length}] stored=${result.stored} deduped=${result.deduped} rejected=${result.rejected}`,
    );
  }

  console.log(`\nSuite 3/3 — replaying ${OPERATION_EVENTS.length} teacher operations (no model call)…`);
  for (const [index, event] of OPERATION_EVENTS.entries()) {
    const status = await event.run(ops);
    console.log(`[${index + 1}/${OPERATION_EVENTS.length}] ${event.label}: ${status}`);
  }

  // ── Duplicate-fact rate, per subject then pooled ──────────────────────────
  const studentRows = await loadRows(prisma, "student", EVAL_STUDENT_ID);
  const staffRows = await loadRows(prisma, "teacher", EVAL_STAFF_ID);
  const studentDup = countDuplicates(studentRows);
  const staffDup = countDuplicates(staffRows);
  const totalRows = studentRows.length + staffRows.length;
  const duplicates = studentDup.duplicates + staffDup.duplicates;
  const duplicatePairs = [...studentDup.pairs, ...staffDup.pairs];
  const duplicateRate = totalRows > 0 ? duplicates / totalRows : 0;

  // ── Retrieval hit rate across all three suites ────────────────────────────
  const misses = [];
  let hits = 0;
  let totalProbes = 0;
  const suiteStats = [];

  for (const suite of [
    { name: "student", subjectType: "student", subjectId: EVAL_STUDENT_ID, scenarios: CONVERSATIONS },
    { name: "staff", subjectType: "teacher", subjectId: EVAL_STAFF_ID, scenarios: STAFF_CONVERSATIONS },
    { name: "operation", subjectType: "student", subjectId: EVAL_STUDENT_ID, scenarios: OPERATION_EVENTS },
  ]) {
    let suiteHits = 0;
    for (const scenario of suite.scenarios) {
      const hit = await probeHit(retrieveMemories, suite.subjectType, suite.subjectId, scenario);
      if (hit) suiteHits++;
      else misses.push(`[${suite.name}] "${scenario.probe}" → expected one of ${JSON.stringify(scenario.expect)}`);
    }
    hits += suiteHits;
    totalProbes += suite.scenarios.length;
    suiteStats.push({ name: suite.name, hits: suiteHits, total: suite.scenarios.length });
  }
  const hitRate = totalProbes > 0 ? hits / totalProbes : 0;

  // ── Privacy checks the two headline gates cannot see ──────────────────────
  const leakedStaffRows = staffRows.filter((row) => looksLikeStudentReference(row.content));
  const strayStudentRows = await prisma.sageMemory.count({
    where: {
      subjectType: "student",
      subjectId: EVAL_STAFF_ID,
    },
  });

  console.log("\n=== Sage Memory Eval ===");
  console.log(`Provider: ${providerLabel}`);
  console.log(
    `Memories stored: ${totalRows} (student ${studentRows.length}, teacher ${staffRows.length})`,
  );
  console.log(
    `  student extract calls: stored=${totals.stored}, hash-deduped=${totals.deduped}, rejected=${totals.rejected}`,
  );
  console.log(
    `  staff extract calls:   stored=${staffTotals.stored}, hash-deduped=${staffTotals.deduped}, rejected=${staffTotals.rejected}`,
  );
  console.log(`Duplicate-fact rate: ${(duplicateRate * 100).toFixed(1)}% (${duplicates}/${totalRows}) — gate: <5%`);
  if (duplicatePairs.length > 0) {
    for (const [a, b] of duplicatePairs.slice(0, 5)) console.log(`  DUP: "${a}"  ≈  "${b}"`);
  }
  console.log(`Retrieval hit rate: ${(hitRate * 100).toFixed(1)}% (${hits}/${totalProbes}) — gate: >=90%`);
  for (const suite of suiteStats) {
    console.log(`  ${suite.name}: ${suite.hits}/${suite.total}`);
  }
  if (misses.length > 0) {
    for (const miss of misses) console.log(`  MISS: ${miss}`);
  }
  console.log(
    `Privacy: staff rows with student-identifying content ${leakedStaffRows.length} (must be 0); student-subject rows written under the staff id ${strayStudentRows} (must be 0)`,
  );
  for (const row of leakedStaffRows.slice(0, 5)) console.log(`  LEAK: "${row.content}"`);
  console.log(`Gates: duplicate ${duplicateRate < 0.05 ? "PASS" : "FAIL"}, retrieval ${hitRate >= 0.9 ? "PASS" : hitRate >= 0.8 ? "MARGINAL" : "FAIL"}`);

  if (!KEEP) {
    await prisma.sageMemory.deleteMany({
      where: {
        OR: [
          { subjectType: "student", subjectId: EVAL_STUDENT_ID },
          { subjectType: "teacher", subjectId: EVAL_STAFF_ID },
        ],
      },
    });
    console.log("(eval rows cleaned up — use --keep to retain)");
  }

  await prisma.$disconnect();
  const exitCode = computeMemoryEvalExitCode({ duplicateRate, hitRate });
  if (exitCode !== 0) process.exitCode = exitCode;
}

// Only auto-run when executed directly (e.g. `npm run sage:memory:eval`) —
// importing this module for computeMemoryEvalExitCode (verification, tests)
// must not trigger the live DB/model pipeline.
const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
