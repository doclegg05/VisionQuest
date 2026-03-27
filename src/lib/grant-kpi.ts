// ---------------------------------------------------------------------------
// Grant KPI computation — WV SPOKES state metrics
//
// Computes the 6 state grant metrics from SpokesRecord +
// SpokesEmploymentFollowUp data, plus "Program of the Year" qualification.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Input shape — matches what the API route fetches from Prisma
// ---------------------------------------------------------------------------

export interface GrantKpiRecord {
  id: string;
  status: string;
  referralDate: Date | null;
  enrolledAt: Date | null;
  unsubsidizedEmploymentAt: Date | null;
  hourlyWage: number | null;
  postSecondaryEnteredAt: Date | null;
  employmentFollowUps: {
    checkpointMonths: number;
    status: string;
  }[];
}

// ---------------------------------------------------------------------------
// Output shapes
// ---------------------------------------------------------------------------

export interface GrantMetric {
  label: string;
  numerator: number;
  denominator: number;
  value: number;
  target: number | null;
  meetsTarget: boolean | null;
}

export interface GrantKpiPayload {
  generatedAt: string;
  programYear: string;
  metrics: {
    enrollmentRate: GrantMetric;
    jobPlacementRate: GrantMetric;
    highWagePlacementRate: GrantMetric;
    postSecondaryTransition: GrantMetric;
    threeMonthRetention: GrantMetric;
    sixMonthRetention: GrantMetric;
  };
  programOfTheYear: {
    qualified: boolean;
    criteria: { label: string; met: boolean; value: number; target: number }[];
  };
  counts: {
    referred: number;
    enrolled: number;
    placed: number;
    highWage: number;
    postSecondary: number;
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pct(numerator: number, denominator: number): number {
  if (denominator === 0) return 0;
  return Math.round((numerator / denominator) * 100);
}

function metric(
  label: string,
  numerator: number,
  denominator: number,
  target: number | null,
): GrantMetric {
  const value = pct(numerator, denominator);
  return {
    label,
    numerator,
    denominator,
    value,
    target,
    meetsTarget: target !== null ? value >= target : null,
  };
}

/**
 * Derive the program year from the current date.
 * WV SPOKES program years run July 1 – June 30.
 * PY2026 = July 1 2025 – June 30 2026.
 */
export function currentProgramYear(now: Date = new Date()): string {
  const month = now.getUTCMonth(); // 0-indexed
  const year = now.getUTCFullYear();
  // July (6) or later = next program year
  const py = month >= 6 ? year + 1 : year;
  return `PY${py}`;
}

// ---------------------------------------------------------------------------
// Main computation
// ---------------------------------------------------------------------------

export function computeGrantKpis(
  records: GrantKpiRecord[],
  now: Date = new Date(),
): GrantKpiPayload {
  const programYear = currentProgramYear(now);

  // Counts
  const referred = records.length;
  const enrolled = records.filter(
    (r) => r.status !== "referred" && r.enrolledAt !== null,
  ).length;
  const placed = records.filter(
    (r) => r.unsubsidizedEmploymentAt !== null,
  ).length;
  const highWage = records.filter(
    (r) => r.unsubsidizedEmploymentAt !== null && r.hourlyWage !== null && r.hourlyWage >= 15,
  ).length;
  const postSecondary = records.filter(
    (r) => r.postSecondaryEnteredAt !== null,
  ).length;

  // Retention — only count records that have reached the checkpoint
  const threeMonthFollowUps = records.flatMap((r) =>
    r.employmentFollowUps.filter((f) => f.checkpointMonths === 3),
  );
  const threeMonthEmployed = threeMonthFollowUps.filter(
    (f) => f.status === "employed",
  ).length;

  const sixMonthFollowUps = records.flatMap((r) =>
    r.employmentFollowUps.filter((f) => f.checkpointMonths === 6),
  );
  const sixMonthEmployed = sixMonthFollowUps.filter(
    (f) => f.status === "employed",
  ).length;

  // Build metrics
  const enrollmentRate = metric("Enrollment Rate", enrolled, referred, 60);
  const jobPlacementRate = metric("Job Placement Rate", placed, enrolled, 30);
  const highWagePlacementRate = metric("High-Wage Placement Rate", highWage, placed, null);
  const postSecondaryTransition = metric("Post-Secondary Transition", postSecondary, enrolled, 5);
  const threeMonthRetention = metric("3-Month Retention Rate", threeMonthEmployed, threeMonthFollowUps.length, null);
  const sixMonthRetention = metric("6-Month Retention Rate", sixMonthEmployed, sixMonthFollowUps.length, null);

  // Program of the Year qualification
  const criteria = [
    { label: "Enrollment Rate >= 60%", met: enrollmentRate.value >= 60, value: enrollmentRate.value, target: 60 },
    { label: "Job Placement Rate >= 30%", met: jobPlacementRate.value >= 30, value: jobPlacementRate.value, target: 30 },
    { label: "Post-Secondary Transition >= 5%", met: postSecondaryTransition.value >= 5, value: postSecondaryTransition.value, target: 5 },
  ];

  return {
    generatedAt: now.toISOString(),
    programYear,
    metrics: {
      enrollmentRate,
      jobPlacementRate,
      highWagePlacementRate,
      postSecondaryTransition,
      threeMonthRetention,
      sixMonthRetention,
    },
    programOfTheYear: {
      qualified: criteria.every((c) => c.met),
      criteria,
    },
    counts: { referred, enrolled, placed, highWage, postSecondary },
  };
}
