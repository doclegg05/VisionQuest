#!/usr/bin/env node
// VQ-R-026: regenerate config/endpoint-inventory.generated.json from the
// src/app/api route tree. Run via `npm run registry:generate` after adding,
// moving, or deleting a route — the parity test in
// src/lib/registry/inventory-parity.test.ts fails CI until the committed
// artifact matches the tree again. Output is deterministic (sorted, no
// timestamp) so diffs are meaningful.
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { walkRouteInventory } from "./lib/endpoint-inventory.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const API_ROOT = path.join(ROOT, "src", "app", "api");
const OUT_PATH = path.join(ROOT, "config", "endpoint-inventory.generated.json");

const routes = walkRouteInventory(API_ROOT);
const wired = routes.filter((r) => r.registryIds.length > 0).length;

writeFileSync(OUT_PATH, JSON.stringify({ routes }, null, 2) + "\n");
console.log(
  `endpoint inventory: ${routes.length} routes (${wired} wired to the registry) → ${path.relative(ROOT, OUT_PATH)}`,
);
