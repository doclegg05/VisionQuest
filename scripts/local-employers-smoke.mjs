import { localEmployersAdapter } from "../src/lib/job-board/adapters/local-employers.ts";
import { filterQualityJobs } from "../src/lib/job-board/job-quality.ts";

try {
  const region = process.argv.slice(2).join(" ").trim() || "Charleston, WV";
  const jobs = filterQualityJobs(await localEmployersAdapter.fetchJobs(region, 25));
  console.log(JSON.stringify({ region, accepted: jobs.jobs.length, rejected: jobs.rejected.length,
    sample: jobs.jobs.slice(0, 5).map(({ title, company, location, salary, url }) => ({ title, company, location, salary, url })) }, null, 2));
  if (!jobs.jobs.length) process.exitCode = 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : "Employer feed check failed.");
  process.exitCode = 1;
}
