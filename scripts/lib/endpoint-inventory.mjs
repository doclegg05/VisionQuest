// VQ-R-026: shared walker for the generated endpoint inventory. Used by both
// scripts/generate-endpoint-inventory.mjs (writes the committed artifact) and
// src/lib/registry/inventory-parity.test.ts (fails CI on drift), so the two
// can never disagree about what "the route tree" means.
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

/** Recursively collect route.ts files under a directory. */
function collectRouteFiles(dir, out = []) {
  for (const entry of readdirSync(dir).sort()) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      collectRouteFiles(full, out);
    } else if (entry === "route.ts") {
      out.push(full);
    }
  }
  return out;
}

/**
 * Walk src/app/api and return the deterministic route inventory:
 * [{ path: "/api/...", methods: ["GET", ...], registryIds: ["ns.action", ...] }]
 * sorted by path. Methods come from exported HTTP handlers; registryIds from
 * withRegistry("<id>") wrappers in the file (empty when the route is unwired —
 * true for most routes; wiring state is exactly what the inventory makes
 * visible).
 */
export function walkRouteInventory(apiRoot) {
  const files = collectRouteFiles(apiRoot);
  const routes = files.map((file) => {
    const source = readFileSync(file, "utf8");
    const methods = HTTP_METHODS.filter((method) =>
      new RegExp(`export\\s+(const\\s+${method}\\b|async\\s+function\\s+${method}\\b|function\\s+${method}\\b)`).test(source),
    );
    const registryIds = [...source.matchAll(/withRegistry\(\s*["']([^"']+)["']/g)]
      .map((m) => m[1])
      .sort();
    const routePath =
      "/api" +
      path
        .dirname(file)
        .slice(apiRoot.length)
        .split(path.sep)
        .join("/");
    return { path: routePath, methods, registryIds };
  });
  routes.sort((a, b) => a.path.localeCompare(b.path));
  return routes;
}
