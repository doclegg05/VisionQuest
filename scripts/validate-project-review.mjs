#!/usr/bin/env node
/**
 * Review-completeness gate for the 2026-07-24 whole-project review.
 *
 * Contract (FROZEN once verified — the report adapts to this gate, never the reverse):
 *   - Report lives at docs/reviews/2026-07-24-project-review.html
 *   - Six sections marked id="section-<name>": strengths, weaknesses, direction, needs, cuts, focus
 *   - Each finding is a tag carrying (lowercase, double- or single-quoted attributes):
 *       data-finding="<section>"            which section it belongs to
 *       data-area="<slug>"                  one of the 30 inventoried feature areas
 *       data-evidence="path[:line], path"   repo-relative paths that must exist on disk
 *         (paths must not contain colons except the optional trailing :line[-line] suffix)
 *   - HTML comments, <script>, and <style> content are ignored for all checks
 *   - Minimum finding counts per section (see MIN_FINDINGS)
 *   - Every one of the 30 area slugs must appear as data-area on a real tag
 *   - Report must be at least MIN_REPORT_BYTES (anti-stub)
 *
 * Exit 0 = PASS, exit 1 = FAIL with itemized reasons.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPORT_PATH = join(ROOT, "docs", "reviews", "2026-07-24-project-review.html");
const MIN_REPORT_BYTES = 25_000;

const MIN_FINDINGS = Object.freeze({
  strengths: 6,
  weaknesses: 10,
  direction: 3,
  needs: 5,
  cuts: 4,
  focus: 3,
});

const REQUIRED_AREAS = Object.freeze([
  "sage-chat",
  "sage-agent-tools",
  "rag-knowledge",
  "crisis-safety",
  "sage-memory",
  "sage-evals",
  "teacher-console",
  "intervention-queue",
  "rls-rbac",
  "auth-security",
  "goals",
  "spokes",
  "job-board",
  "forms-engine",
  "orientation",
  "career-resume",
  "certifications",
  "progression-xp",
  "coordinator",
  "admin",
  "notifications",
  "mood-checkins",
  "vision-board",
  "documents-files",
  "catalog-registry",
  "dependencies-build",
  "testing-instruments",
  "ci-cd",
  "product-docs",
  "data-lifecycle",
]);

/** Remove content that must never satisfy a check: comments, scripts, styles. */
function stripInertContent(html) {
  return html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<script\b[\s\S]*?<\/script>/g, "")
    .replace(/<style\b[\s\S]*?<\/style>/g, "");
}

/** Extract a lowercase attribute value from a single tag; supports "..." and '...'. */
function attrValue(tag, name) {
  const match = tag.match(new RegExp(`(?:^|\\s)${name}=(?:"([^"]*)"|'([^']*)')`));
  if (!match) return null;
  return match[1] ?? match[2];
}

function findingTags(html) {
  return html.match(/<[a-z][a-z0-9-]*\b[^>]*\sdata-finding=(?:"[^"]*"|'[^']*')[^>]*>/g) ?? [];
}

function normalizeEvidencePath(raw) {
  return raw.trim().replace(/:\d+(?:-\d+)?$/, "");
}

function evidenceProblems(rawEvidence, label) {
  const paths = (rawEvidence ?? "")
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  if (paths.length === 0) {
    return [`${label}: data-evidence is missing or empty`];
  }
  return paths.flatMap((p) => {
    if (p.startsWith("/") || p.includes("..")) {
      return [`${label}: evidence path "${p}" must be repo-relative with no traversal`];
    }
    const normalized = normalizeEvidencePath(p);
    return existsSync(join(ROOT, normalized))
      ? []
      : [`${label}: evidence path "${normalized}" does not exist in the repo`];
  });
}

function checkReport() {
  if (!existsSync(REPORT_PATH)) {
    return { failures: [`report not found at ${REPORT_PATH}`], summary: null };
  }

  const bytes = statSync(REPORT_PATH).size;
  const html = stripInertContent(readFileSync(REPORT_PATH, "utf8"));
  const failures = [];

  if (bytes < MIN_REPORT_BYTES) {
    failures.push(`report is ${bytes} bytes; minimum is ${MIN_REPORT_BYTES} (anti-stub check)`);
  }

  for (const section of Object.keys(MIN_FINDINGS)) {
    if (!html.includes(`id="section-${section}"`)) {
      failures.push(`missing section marker id="section-${section}"`);
    }
  }

  const tags = findingTags(html);
  const counts = Object.fromEntries(Object.keys(MIN_FINDINGS).map((s) => [s, 0]));

  tags.forEach((tag, index) => {
    const section = attrValue(tag, "data-finding");
    const area = attrValue(tag, "data-area");
    const label = `finding #${index + 1} (${section ?? "?"} / ${area ?? "?"})`;

    if (!Object.hasOwn(MIN_FINDINGS, section)) {
      failures.push(`${label}: unknown section "${section}"`);
    } else {
      counts[section] += 1;
    }
    if (!REQUIRED_AREAS.includes(area)) {
      failures.push(`${label}: data-area "${area}" is not one of the 30 inventoried areas`);
    }
    failures.push(...evidenceProblems(attrValue(tag, "data-evidence"), label));
  });

  for (const [section, minimum] of Object.entries(MIN_FINDINGS)) {
    if (counts[section] < minimum) {
      failures.push(`section "${section}" has ${counts[section]} findings; minimum is ${minimum}`);
    }
  }

  const areasPresent = new Set(
    [...html.matchAll(/\sdata-area=(?:"([a-z0-9-]+)"|'([a-z0-9-]+)')/g)].map((m) => m[1] ?? m[2]),
  );
  const missingAreas = REQUIRED_AREAS.filter((area) => !areasPresent.has(area));
  if (missingAreas.length > 0) {
    failures.push(`areas never covered (${missingAreas.length}/30): ${missingAreas.join(", ")}`);
  }

  const summary = {
    bytes,
    counts,
    totalFindings: tags.length,
    areasCovered: REQUIRED_AREAS.length - missingAreas.length,
  };
  return { failures, summary };
}

function main() {
  console.log(`review:gate — checking ${REPORT_PATH}`);
  const { failures, summary } = checkReport();

  if (summary) {
    console.log(`  bytes: ${summary.bytes}`);
    console.log(
      `  findings: ${summary.totalFindings} total — ${Object.entries(summary.counts)
        .map(([s, n]) => `${s}=${n}`)
        .join(", ")}`,
    );
    console.log(`  areas covered: ${summary.areasCovered}/${REQUIRED_AREAS.length}`);
  }

  if (failures.length > 0) {
    console.error(`\nFAIL — ${failures.length} problem(s):`);
    failures.forEach((f) => console.error(`  ✗ ${f}`));
    process.exitCode = 1;
    return;
  }

  console.log("\nPASS — review report satisfies the completeness gate.");
}

main();
