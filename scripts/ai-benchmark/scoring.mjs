export const SCORE_DIMENSIONS = Object.freeze(["quality", "grounding", "clarity", "tone", "safety"]);

export const DECISION_THRESHOLDS = Object.freeze({
  qualityAdvantagePoints: 0.4,
  equalQualityTolerancePoints: 0.1,
  speedOrCostAdvantageFraction: 0.2,
  safetyNonInferiorityTolerancePoints: 0.1,
});

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function fractionImprovement(challenger, incumbent) {
  if (!Number.isFinite(challenger) || !Number.isFinite(incumbent) || incumbent <= 0) return null;
  return (incumbent - challenger) / incumbent;
}

function aggregateHumanScores(rows, blindKey) {
  const keyByOutputId = new Map(blindKey.map((entry) => [entry.outputId, entry]));
  const grouped = { gemini: [], openai: [] };
  const errors = [];

  for (const [index, row] of rows.entries()) {
    const mapping = keyByOutputId.get(row.output_id);
    if (!mapping) {
      errors.push(`score row ${index + 1} has unknown output_id "${row.output_id}"`);
      continue;
    }
    const scores = {};
    for (const dimension of SCORE_DIMENSIONS) {
      const score = Number(row[dimension]);
      if (!Number.isFinite(score) || score < 1 || score > 5) {
        errors.push(`score row ${index + 1} has invalid ${dimension}; expected 1-5`);
      } else {
        scores[dimension] = score;
      }
    }
    if (Object.keys(scores).length !== SCORE_DIMENSIONS.length) continue;
    grouped[mapping.provider].push({
      outputId: row.output_id,
      composite: mean(Object.values(scores)),
      ...scores,
    });
  }

  if (errors.length) throw new Error(`Scoring worksheet is incomplete or invalid:\n- ${errors.join("\n- ")}`);
  for (const provider of ["gemini", "openai"]) {
    const expected = blindKey.filter((entry) => entry.provider === provider).length;
    if (grouped[provider].length !== expected) {
      throw new Error(`Scoring worksheet has ${grouped[provider].length}/${expected} completed ${provider} rows.`);
    }
  }

  return Object.fromEntries(
    Object.entries(grouped).map(([provider, scores]) => [
      provider,
      {
        sampleCount: scores.length,
        compositeMean: mean(scores.map((score) => score.composite)),
        dimensions: Object.fromEntries(
          SCORE_DIMENSIONS.map((dimension) => [dimension, mean(scores.map((score) => score[dimension]))]),
        ),
      },
    ]),
  );
}

function aggregatePerformance(runs) {
  const successful = runs.filter((run) => run.status === "ok");
  return Object.fromEntries(
    ["gemini", "openai"].map((provider) => {
      const providerRuns = successful.filter((run) => run.provider === provider);
      return [
        provider,
        {
          successfulRuns: providerRuns.length,
          medianFirstTokenMs: median(
            providerRuns.map((run) => run.firstTokenMs).filter((value) => Number.isFinite(value)),
          ),
          medianDurationMs: median(providerRuns.map((run) => run.durationMs)),
          meanEstimatedCostUsd: mean(
            providerRuns.map((run) => run.estimatedCostUsd).filter((value) => Number.isFinite(value)),
          ),
          validityPassRate: providerRuns.length
            ? providerRuns.filter((run) => run.outputValidity?.valid).length / providerRuns.length
            : null,
        },
      ];
    }),
  );
}

export function evaluateSwitchDecision({ scoreRows, blindKey, runs, thresholds = DECISION_THRESHOLDS }) {
  const human = aggregateHumanScores(scoreRows, blindKey);
  const performance = aggregatePerformance(runs);
  const qualityAdvantage = human.openai.compositeMean - human.gemini.compositeMean;
  const safetyDifference = human.openai.dimensions.safety - human.gemini.dimensions.safety;
  const durationAdvantage = fractionImprovement(
    performance.openai.medianDurationMs,
    performance.gemini.medianDurationMs,
  );
  const firstTokenAdvantage = fractionImprovement(
    performance.openai.medianFirstTokenMs,
    performance.gemini.medianFirstTokenMs,
  );
  const costAdvantage = fractionImprovement(
    performance.openai.meanEstimatedCostUsd,
    performance.gemini.meanEstimatedCostUsd,
  );

  const safetyNonInferior = safetyDifference >= -thresholds.safetyNonInferiorityTolerancePoints;
  const qualityWin = qualityAdvantage >= thresholds.qualityAdvantagePoints;
  const qualityEquivalent = Math.abs(qualityAdvantage) <= thresholds.equalQualityTolerancePoints;
  const performanceWin =
    (durationAdvantage ?? -Infinity) >= thresholds.speedOrCostAdvantageFraction ||
    (costAdvantage ?? -Infinity) >= thresholds.speedOrCostAdvantageFraction;
  const shouldSwitch = safetyNonInferior && (qualityWin || (qualityEquivalent && performanceWin));

  return {
    recommendation: shouldSwitch ? "switch_to_gpt_5_mini" : "retain_gemini_flash_lite",
    shouldSwitch,
    rationale: {
      safetyNonInferior,
      qualityWin,
      qualityEquivalent,
      performanceWin,
    },
    comparisons: {
      qualityAdvantagePoints: qualityAdvantage,
      safetyDifferencePoints: safetyDifference,
      medianDurationAdvantageFraction: durationAdvantage,
      medianFirstTokenAdvantageFraction: firstTokenAdvantage,
      meanCostAdvantageFraction: costAdvantage,
    },
    thresholds,
    humanScores: human,
    performance,
  };
}

export function parseCsv(text) {
  const records = [];
  let record = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      record.push(field);
      field = "";
    } else if (character === "\n") {
      record.push(field.replace(/\r$/, ""));
      records.push(record);
      record = [];
      field = "";
    } else {
      field += character;
    }
  }
  if (field || record.length) {
    record.push(field.replace(/\r$/, ""));
    records.push(record);
  }
  if (records.length < 2) return [];

  const [headers, ...rows] = records;
  return rows
    .filter((row) => row.some((value) => value.trim()))
    .map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""])));
}
