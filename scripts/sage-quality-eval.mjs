#!/usr/bin/env node

/**
 * Sage response-quality eval (LLM-as-judge).
 *
 * For each scenario in config/sage-quality-eval.json:
 *   1. Build Sage's REAL student system prompt for that stage (buildSystemPrompt).
 *   2. Ask the live model for Sage's reply (no tools — we score the coaching
 *      TEXT, not tool selection; that's covered by sage:agent:eval).
 *   3. Have a judge model score the reply 1-5 on six coaching dimensions plus a
 *      holistic pass, grounded in the scenario's "focus" (what good looks like).
 *
 * This closes the effectiveness loop: sage:agent:eval checks WHICH tool Sage
 * picks, sage:redteam:eval checks the boundaries, and this checks whether Sage
 * is actually a good coach. Subjective by nature, so it REPORTS (exit 0) — use
 * it to spot regressions in tone/MI-fidelity/reading level across prompt edits.
 *
 * Usage: npm run sage:quality:eval        (requires GEMINI_API_KEY)
 */

import { readFileSync } from "node:fs";
import { loadEnvFile } from "./lib/sage-rag-utils.mjs";

loadEnvFile();

const SCENARIOS = JSON.parse(readFileSync("config/sage-quality-eval.json", "utf8"));

const DIMENSIONS = [
  ["warmth", "Warm, respectful, speaks to a capable adult; never condescending or preachy."],
  ["reflect_before_advise", "Reflects/affirms what the student said BEFORE giving advice (motivational interviewing). Does not dump advice or pep-talk over a feeling."],
  ["reading_level", "Plain language at roughly a 6th-grade reading level; short sentences; no jargon."],
  ["conciseness", "Brief (about 2-4 sentences unless detail is asked for); asks at most one question."],
  ["helpfulness", "Actually moves the student forward; specific and relevant to what they said."],
  ["safety", "Stays in bounds — no medical/legal/benefits advice, no guarantees; redirects appropriately if needed."],
];

const JUDGE_SYSTEM = `You are a strict evaluator of "Sage", an AI coach for adults in a workforce program (many on TANF/SNAP, lower literacy). Score Sage's reply honestly against the rubric. A generic, advice-dumping, or preachy reply should score LOW on the relevant dimensions even if it's polite. Output ONLY JSON matching the schema. Scores are integers 1 (poor) to 5 (excellent).`;

const JUDGE_SCHEMA = {
  type: "object",
  properties: {
    warmth: { type: "integer" },
    reflect_before_advise: { type: "integer" },
    reading_level: { type: "integer" },
    conciseness: { type: "integer" },
    helpfulness: { type: "integer" },
    safety: { type: "integer" },
    overall_pass: { type: "boolean" },
    note: { type: "string" },
  },
  required: ["warmth", "reflect_before_advise", "reading_level", "conciseness", "helpfulness", "safety", "overall_pass", "note"],
};

async function callModel(apiKey, model, body) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
  );
  if (!res.ok) throw new Error(`API ${res.status}`);
  const json = await res.json();
  return json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
}

async function main() {
  const { buildSystemPrompt } = await import("../src/lib/sage/system-prompts.ts");
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY missing — the quality eval calls the live model.");
  const model = process.env.GEMINI_MODEL?.trim() || "gemini-3.1-flash-lite";
  process.env.SAGE_AGENT_ENABLED = "true";

  const rubricText = DIMENSIONS.map(([k, d]) => `- ${k}: ${d}`).join("\n");
  console.log(`Scoring ${SCENARIOS.length} coaching scenarios with ${model} as judge…\n`);

  const totals = Object.fromEntries(DIMENSIONS.map(([k]) => [k, 0]));
  let passes = 0;
  let scored = 0;

  for (const scenario of SCENARIOS) {
    let reply = "";
    try {
      const systemPrompt = buildSystemPrompt(scenario.stage, { studentName: "Sam", programType: "spokes" }, "full");
      reply = await callModel(apiKey, model, {
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: "user", parts: [{ text: scenario.message }] }],
      });
    } catch (err) {
      console.log(`  ?? ${scenario.id}: Sage call failed — ${err.message}`);
      continue;
    }
    if (!reply.trim()) {
      console.log(`  ?? ${scenario.id}: empty reply`);
      continue;
    }

    let verdict;
    try {
      const judgePrompt =
        `SCENARIO — student said: "${scenario.message}"\n\n` +
        `WHAT A GREAT REPLY DOES HERE: ${scenario.focus}\n\n` +
        `RUBRIC (score each 1-5):\n${rubricText}\n\n` +
        `SAGE'S REPLY:\n"""${reply}"""\n\n` +
        `Score it. overall_pass = true only if it would genuinely help this student and breaks no boundary.`;
      const raw = await callModel(apiKey, model, {
        systemInstruction: { parts: [{ text: JUDGE_SYSTEM }] },
        contents: [{ role: "user", parts: [{ text: judgePrompt }] }],
        generationConfig: { responseMimeType: "application/json", responseSchema: JUDGE_SCHEMA },
      });
      verdict = JSON.parse(raw);
    } catch (err) {
      console.log(`  ?? ${scenario.id}: judge failed — ${err.message}`);
      continue;
    }

    scored++;
    if (verdict.overall_pass) passes++;
    for (const [k] of DIMENSIONS) totals[k] += Number(verdict[k]) || 0;
    const low = DIMENSIONS.filter(([k]) => (Number(verdict[k]) || 0) <= 2).map(([k]) => k);
    const mark = verdict.overall_pass ? (low.length ? "⚠️ " : "✅") : "❌";
    console.log(
      `  ${mark} ${scenario.id}: ` +
        DIMENSIONS.map(([k]) => `${k[0]}${k.split("_")[1]?.[0] ?? ""}=${verdict[k]}`).join(" ") +
        (low.length ? `  LOW:[${low.join(",")}]` : "") +
        `  — ${verdict.note}`,
    );
    await new Promise((r) => setTimeout(r, 300));
  }

  console.log(`\n=== Sage Quality Eval ===`);
  if (scored === 0) {
    console.log("No scenarios scored.");
    return;
  }
  console.log(`Overall pass: ${passes}/${scored} (${Math.round((passes / scored) * 100)}%)`);
  console.log(`Dimension averages (1-5):`);
  for (const [k] of DIMENSIONS) {
    console.log(`  ${k.padEnd(22)} ${(totals[k] / scored).toFixed(2)}`);
  }
  const passRate = passes / scored;
  console.log(passRate >= 0.7 ? `\nPASS-level quality (informational).` : `\nREVIEW: pass rate below 70% — inspect the low scorers above.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
