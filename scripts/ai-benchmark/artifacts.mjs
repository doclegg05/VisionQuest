import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { SCORE_DIMENSIONS } from "./scoring.mjs";

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function summarizeRuns(runs) {
  return Object.fromEntries(
    ["gemini", "openai"].map((provider) => {
      const providerRuns = runs.filter((run) => run.provider === provider);
      const successful = providerRuns.filter((run) => run.status === "ok");
      return [
        provider,
        {
          attemptedRuns: providerRuns.length,
          successfulRuns: successful.length,
          failedRuns: providerRuns.length - successful.length,
          outputValidityPassRate: successful.length
            ? successful.filter((run) => run.outputValidity.valid).length / successful.length
            : null,
          medianFirstTokenMs: median(
            successful.map((run) => run.firstTokenMs).filter((value) => Number.isFinite(value)),
          ),
          medianDurationMs: median(successful.map((run) => run.durationMs)),
          meanEstimatedCostUsd: mean(
            successful.map((run) => run.estimatedCostUsd).filter((value) => Number.isFinite(value)),
          ),
          totalEstimatedCostUsd: successful
            .map((run) => run.estimatedCostUsd)
            .filter((value) => Number.isFinite(value))
            .reduce((sum, value) => sum + value, 0),
        },
      ];
    }),
  );
}

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function worksheetCsv(blindOutputs) {
  const headers = [
    "output_id",
    "case_id",
    "category",
    "repetition",
    "response_label",
    ...SCORE_DIMENSIONS,
    "notes",
  ];
  const rows = blindOutputs.map((entry) => [
    entry.outputId,
    entry.caseId,
    entry.category,
    entry.repetition,
    entry.responseLabel,
    ...SCORE_DIMENSIONS.map(() => ""),
    "",
  ]);
  return [headers, ...rows].map((row) => row.map(csvEscape).join(",")).join("\n") + "\n";
}

export function createBlindPacket(runs, random) {
  const grouped = new Map();
  for (const run of runs) {
    const key = `${run.caseId}::${run.repetition}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(run);
  }

  const outputs = [];
  const key = [];
  for (const pair of grouped.values()) {
    if (pair.length !== 2 || new Set(pair.map((run) => run.provider)).size !== 2) {
      throw new Error("Blind packet requires exactly one Gemini and one OpenAI run per case repetition.");
    }
    const ordered = random() < 0.5 ? pair : [...pair].reverse();
    ordered.forEach((run, index) => {
      const responseLabel = index === 0 ? "A" : "B";
      const outputId = `${run.caseId}-r${run.repetition}-${responseLabel}`;
      outputs.push({
        outputId,
        caseId: run.caseId,
        category: run.category,
        repetition: run.repetition,
        responseLabel,
        output: run.status === "ok" ? run.output : "[RUN FAILED — no response available]",
      });
      key.push({
        outputId,
        provider: run.provider,
        model: run.model,
        runSequence: run.sequence,
      });
    });
  }
  return { outputs, key, worksheet: worksheetCsv(outputs) };
}

export async function writeRunArtifacts(outputDirectory, payload) {
  await mkdir(outputDirectory, { recursive: true });
  await Promise.all([
    writeFile(join(outputDirectory, "manifest.json"), `${JSON.stringify(payload.manifest, null, 2)}\n`),
    writeFile(
      join(outputDirectory, "runs.jsonl"),
      payload.runs.map((run) => JSON.stringify(run)).join("\n") + "\n",
    ),
    writeFile(join(outputDirectory, "summary.json"), `${JSON.stringify(payload.summary, null, 2)}\n`),
    writeFile(
      join(outputDirectory, "blind-outputs.jsonl"),
      payload.blind.outputs.map((entry) => JSON.stringify(entry)).join("\n") + "\n",
    ),
    writeFile(join(outputDirectory, "blind-key.json"), `${JSON.stringify(payload.blind.key, null, 2)}\n`),
    writeFile(join(outputDirectory, "blind-scoring.csv"), payload.blind.worksheet),
  ]);
}
