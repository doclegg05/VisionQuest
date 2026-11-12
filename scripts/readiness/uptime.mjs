import { pathToFileURL } from "node:url";

export async function checkUptime(url, fetchImpl = fetch) {
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(10_000), redirect: "error" });
  const body = await response.json();
  if (!response.ok || body.status !== "healthy" || body.sage?.connected !== true) {
    throw new Error("VisionQuest or Sage is unavailable. Follow docs/runbooks/incident-basics.md.");
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  checkUptime("https://visionquest.onrender.com/api/health").then(
    () => console.log("VisionQuest and Sage connection checks passed."),
    () => { console.error("::error::VisionQuest or Sage connection check failed."); process.exitCode = 1; },
  );
}
