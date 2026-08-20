#!/usr/bin/env node

/**
 * Pathway-to-placement attribution report.
 *
 * Read-only. Prints, per SPOKES career cluster, how many verified placements
 * came from applications that were filed under that pathway — the first data
 * the program has that could say whether suggested pathways lead to jobs.
 *
 * The chain it walks is documented in src/lib/pathway-outcomes.ts, which owns
 * the queries and the arithmetic; this file is just an entry point and a
 * printer. Read that module's header before quoting these numbers at anyone:
 * coverage climbs from zero because applications filed before the provenance
 * field shipped carry no pathway at all.
 *
 * A `.ts` entry run via tsx (like scripts/seed-progression-edges.ts): a
 * `.mjs` entry importing named exports from `.ts` modules fails to link under
 * the repo's tsx/Node loader combination.
 *
 * Usage:
 *   npx tsx scripts/pathway-outcomes-report.ts
 *   npx tsx scripts/pathway-outcomes-report.ts --json
 *   npx tsx scripts/pathway-outcomes-report.ts --dry-run   # synthetic rows, no DB
 *   DATABASE_URL="..." npx tsx scripts/pathway-outcomes-report.ts
 */

import { loadEnvConfig } from "@next/env";
import { PrismaClient } from "@prisma/client";
import {
  buildPathwayPlacementReport,
  type PathwayOutcomeReader,
  type PathwayPlacementReport,
} from "../src/lib/pathway-outcomes";

loadEnvConfig(process.cwd(), true);

const asJson = process.argv.includes("--json");
const dryRun = process.argv.includes("--dry-run");

/**
 * Synthetic reader for `--dry-run` (same idea as scripts/sage-usage-summary.mjs):
 * previews the output shape with no database. One placement deliberately
 * carries no pathway, so a dry run always shows the coverage gap the real
 * report will show while the backfill-free column fills up.
 */
const DRY_RUN_READER: PathwayOutcomeReader = {
  spokesRecord: {
    findMany: async () => [
      {
        unsubsidizedEmploymentAt: new Date("2026-06-02"),
        placementApplication: { id: "app-1", pathwayClusterId: "office-admin" },
      },
      {
        unsubsidizedEmploymentAt: new Date("2026-06-18"),
        placementApplication: { id: "app-2", pathwayClusterId: "office-admin" },
      },
      {
        unsubsidizedEmploymentAt: new Date("2026-07-09"),
        placementApplication: { id: "app-3", pathwayClusterId: "customer-service" },
      },
      {
        unsubsidizedEmploymentAt: new Date("2026-07-21"),
        placementApplication: { id: "app-4", pathwayClusterId: null },
      },
    ],
  },
  application: {
    findMany: async () => [
      ...Array.from({ length: 9 }, () => ({ pathwayClusterId: "office-admin" })),
      ...Array.from({ length: 6 }, () => ({ pathwayClusterId: "customer-service" })),
      ...Array.from({ length: 4 }, () => ({ pathwayClusterId: "creative-design" })),
    ],
  },
};

function pad(value: string, width: number): string {
  return value.length >= width ? value : value + " ".repeat(width - value.length);
}

function padLeft(value: string, width: number): string {
  return value.length >= width ? value : " ".repeat(width - value.length) + value;
}

function printReport(report: PathwayPlacementReport): void {
  console.log("");
  console.log("Pathway -> placement attribution");
  console.log(`Generated ${report.generatedAt}`);
  console.log("");
  console.log(`  Verified placements with an application link : ${report.totalVerifiedPlacements}`);
  console.log(`  ...carrying a pathway                        : ${report.placementsWithPathway}`);
  console.log(`  ...with no pathway recorded                  : ${report.placementsWithoutPathway}`);
  console.log(`  Pathway coverage                             : ${report.pathwayCoveragePct}%`);
  console.log("");

  if (report.byCluster.length === 0) {
    console.log("  No application yet carries a pathway. Nothing to attribute.");
    console.log("");
    return;
  }

  const header = `  ${pad("CLUSTER", 34)}${padLeft("PLACED", 7)}${padLeft("SHARE", 7)}${padLeft("APPS", 7)}${padLeft("RATE", 7)}`;
  console.log(header);
  console.log(`  ${"-".repeat(header.length - 2)}`);
  for (const row of report.byCluster) {
    const rate =
      row.placementRatePctOfApplications === null
        ? "n/a"
        : `${row.placementRatePctOfApplications}%`;
    console.log(
      `  ${pad(row.label, 34)}${padLeft(String(row.placements), 7)}${padLeft(
        `${row.shareOfAttributedPlacementsPct}%`,
        7,
      )}${padLeft(String(row.applicationsWithThisPathway), 7)}${padLeft(rate, 7)}`,
    );
  }
  console.log("");
  console.log("  SHARE = share of the placements we could trace. RATE = placements");
  console.log("  per job application on that pathway (n/a when there are none).");
  console.log("");
}

const prisma = dryRun ? null : new PrismaClient();

buildPathwayPlacementReport(prisma ?? DRY_RUN_READER)
  .then((report) => {
    if (asJson) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }
    if (dryRun) console.log("\n*** DRY RUN — synthetic rows, no database ***");
    printReport(report);
  })
  .catch((error: unknown) => {
    console.error("Pathway outcomes report failed:", error);
    process.exitCode = 1;
  })
  .finally(() => prisma?.$disconnect());
