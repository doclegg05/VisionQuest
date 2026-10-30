// Read-only public-source check. No application DB or credentials needed.
import { wvuMedicineAdapter } from "../src/lib/job-board/adapters/wvu-medicine.ts";
import { filterQualityJobs } from "../src/lib/job-board/job-quality.ts";

const region = process.argv.slice(2).join(" ").trim() || "Summersville, WV";
try {
  const start = Date.now();
  const jobs = await wvuMedicineAdapter.fetchJobs(region, 25);
  const quality = filterQualityJobs(jobs);
  console.log(JSON.stringify({
    source: wvuMedicineAdapter.source,
    region,
    matched: jobs.length,
    accepted: quality.jobs.length,
    rejected: quality.rejected.map(({ reason }) => reason),
    durationMs: Date.now() - start,
    sample: quality.jobs.slice(0, 5).map(({ sourceId, title, location, employmentType, url }) =>
      ({ sourceId, title, location, employmentType, url })),
  }, null, 2));
  if (!quality.jobs.length) process.exitCode = 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : "Employer job-source check failed.");
  process.exitCode = 1;
}
