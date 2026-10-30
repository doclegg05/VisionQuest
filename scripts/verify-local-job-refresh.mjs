// Live-source integration check, restricted to an explicitly local test DB/app.
import { request } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { E2E_CLASS, E2E_STUDENT, E2E_TEACHER } from "../e2e/fixtures.ts";
import { assertSafeE2eSeedTarget } from "../src/lib/e2e-seed-guard.ts";

const base = process.env.APP_BASE_URL;
if (!base || !["127.0.0.1", "localhost"].includes(new URL(base).hostname)) throw new Error("A local APP_BASE_URL is required.");
assertSafeE2eSeedTarget(process.env.DATABASE_URL, { allowRemote: false });
const prisma = new PrismaClient();
const teacher = await request.newContext({ baseURL: base, extraHTTPHeaders: { Origin: base } });
const student = await request.newContext({ baseURL: base, extraHTTPHeaders: { Origin: base } });
try {
  for (const [client, user] of [[teacher, E2E_TEACHER], [student, E2E_STUDENT]]) {
    const login = await client.post("/api/auth/login", { data: { studentId: user.login, password: user.password } });
    if (!login.ok()) throw new Error(`Synthetic login failed: HTTP ${login.status()}`);
  }
  const cohort = await prisma.spokesClass.findUniqueOrThrow({ where: { code: E2E_CLASS.code } });
  const config = await teacher.put("/api/teacher/jobs/config", { data: { classId: cohort.id, region: "Summersville, WV", sources: ["wvumedicine", "localemployers"], localJobPriority: "prefer_local", autoRefresh: true } });
  if (!config.ok()) throw new Error(`Teacher configuration failed: HTTP ${config.status()}`);
  const refresh = await teacher.post("/api/teacher/jobs/refresh", { data: { classId: cohort.id } });
  if (!refresh.ok()) throw new Error(`Teacher refresh failed: HTTP ${refresh.status()}`);
  let result;
  for (let attempt = 0; attempt < 45; attempt++) {
    const status = await teacher.get(`/api/teacher/jobs/status?classId=${cohort.id}`);
    if (!status.ok()) throw new Error(`Status failed: HTTP ${status.status()}`);
    result = await status.json();
    if (["completed", "failed"].includes(result.latestRun?.status)) break;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  if (result?.latestRun?.status !== "completed") throw new Error(`Refresh did not complete: ${result?.latestRun?.status}`);
  const response = await student.get("/api/jobs?proximity=local&sort=recent");
  if (!response.ok()) throw new Error(`Student search failed: HTTP ${response.status()}`);
  const data = await response.json();
  const job = data.jobs.find((item) => /housekeep|secretary|aide|cashier/i.test(item.title) && item.source === "wvumedicine");
  if (!job) throw new Error("No live employer support-role listing was available for the student check.");
  const save = await student.post("/api/jobs/save", { data: { jobListingId: job.id, status: "applied", notes: "Synthetic live-source integration check." } });
  if (!save.ok()) throw new Error(`Save failed: HTTP ${save.status()}`);
  const reloaded = await (await student.get("/api/jobs?proximity=local")).json();
  const saved = reloaded.jobs.find((item) => item.id === job.id);
  if (saved?.savedStatus !== "applied" || saved.savedNotes !== "Synthetic live-source integration check.") throw new Error("Applied status did not persist.");
  console.log(JSON.stringify({ refresh: result.latestRun.status, sourceResults: result.latestRun.sourceResults.map(({ source, status, upsertedCount }) => ({ source, status, upsertedCount })), localJobs: data.jobs.length, savedTitle: job.title, persistedStatus: saved.savedStatus }, null, 2));
} finally {
  await teacher.dispose(); await student.dispose(); await prisma.$disconnect();
}
