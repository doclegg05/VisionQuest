#!/usr/bin/env node

/**
 * Sage memory eval (Phase 2 acceptance).
 *
 * Replays 20 synthetic scripted conversations for a sentinel test student
 * through the REAL extract -> store -> retrieve pipeline (live model + dev DB),
 * then reports:
 *   - duplicate-fact rate: % of stored memories whose embedding is >= 0.92
 *     cosine-similar to an earlier stored memory (gate: < 5%)
 *   - retrieval hit rate: % of probe queries whose expected fact surfaces
 *     in retrieveMemories() results
 *
 * Conversations 16-20 deliberately restate facts from 1-5 in different
 * wording — the dedupe stress test.
 *
 * Usage: npm run sage:memory:eval  (add --keep to skip cleanup)
 */

import { loadEnvFile } from "./lib/sage-rag-utils.mjs";

loadEnvFile();

const EVAL_STUDENT_ID = "sage-memory-eval-student";
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

async function main() {
  const { prisma } = await import("../src/lib/db.ts");
  const { GeminiProvider } = await import("../src/lib/ai/gemini-provider.ts");
  const { extractAndStoreMemories } = await import("../src/lib/sage/memory/extract.ts");
  const { retrieveMemories } = await import("../src/lib/sage/memory/retrieve.ts");

  // Clean slate for the sentinel student.
  await prisma.sageMemory.deleteMany({
    where: { subjectType: "student", subjectId: EVAL_STUDENT_ID },
  });

  const provider = new GeminiProvider(process.env.GEMINI_API_KEY ?? "");
  const totals = { stored: 0, deduped: 0, rejected: 0 };

  console.log(`Replaying ${CONVERSATIONS.length} conversations…`);
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

  // Duplicate-fact rate: embedding-level near-duplicates among stored rows.
  const rows = await prisma.$queryRawUnsafe(
    `SELECT id, content, embedding::text AS vec, "createdAt"
     FROM "visionquest"."SageMemory"
     WHERE "subjectType" = 'student' AND "subjectId" = $1 AND "validTo" IS NULL AND embedding IS NOT NULL
     ORDER BY "createdAt" ASC`,
    EVAL_STUDENT_ID,
  );
  const vectors = rows.map((row) => JSON.parse(row.vec));
  let duplicates = 0;
  const duplicatePairs = [];
  for (let i = 1; i < vectors.length; i++) {
    for (let j = 0; j < i; j++) {
      if (cosineSimilarity(vectors[i], vectors[j]) >= DUP_SIMILARITY) {
        duplicates++;
        duplicatePairs.push([rows[j].content, rows[i].content]);
        break;
      }
    }
  }
  const duplicateRate = rows.length > 0 ? duplicates / rows.length : 0;

  // Retrieval hit rate over the probe queries.
  let hits = 0;
  const misses = [];
  for (const conversation of CONVERSATIONS) {
    const retrieved = await retrieveMemories("student", EVAL_STUDENT_ID, conversation.probe);
    const hit = retrieved.some((memory) =>
      conversation.expect.some((keyword) =>
        memory.content.toLowerCase().includes(keyword.toLowerCase()),
      ),
    );
    if (hit) hits++;
    else misses.push(`"${conversation.probe}" → expected one of ${JSON.stringify(conversation.expect)}`);
  }
  const hitRate = hits / CONVERSATIONS.length;

  console.log("\n=== Sage Memory Eval ===");
  console.log(`Memories stored: ${rows.length} (extract calls: stored=${totals.stored}, hash-deduped=${totals.deduped}, rejected=${totals.rejected})`);
  console.log(`Duplicate-fact rate: ${(duplicateRate * 100).toFixed(1)}% (${duplicates}/${rows.length}) — gate: <5%`);
  if (duplicatePairs.length > 0) {
    for (const [a, b] of duplicatePairs.slice(0, 5)) console.log(`  DUP: "${a}"  ≈  "${b}"`);
  }
  console.log(`Retrieval hit rate: ${(hitRate * 100).toFixed(1)}% (${hits}/${CONVERSATIONS.length})`);
  if (misses.length > 0) {
    for (const miss of misses) console.log(`  MISS: ${miss}`);
  }
  console.log(`Gates: duplicate ${duplicateRate < 0.05 ? "PASS" : "FAIL"}, retrieval ${hitRate >= 0.9 ? "PASS" : hitRate >= 0.8 ? "MARGINAL" : "FAIL"}`);

  if (!KEEP) {
    await prisma.sageMemory.deleteMany({
      where: { subjectType: "student", subjectId: EVAL_STUDENT_ID },
    });
    console.log("(eval rows cleaned up — use --keep to retain)");
  }

  await prisma.$disconnect();
  if (duplicateRate >= 0.05) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
