/**
 * "Am I the entry point?" — the guard every CLI and self-testable scorer uses.
 *
 * The obvious form is wrong in a way that fails silently:
 *
 *     if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
 *
 * Node resolves a module's real path when it loads it, so `import.meta.url`
 * points at the target of any symlink while `process.argv[1]` keeps the link
 * the user typed. Invoke the script through a symlink — a packaging step, a
 * `bin` shim, a checkout mounted through one — and the comparison is false,
 * `main()` never runs, and the process exits **0**. A gate that exits 0 having
 * done nothing is worse than no gate: it reports success.
 *
 * Resolving argv[1] with `realpathSync` makes both sides the same kind of
 * path. A missing or unresolvable argv[1] answers `false`, which is the safe
 * direction for an imported module.
 */

import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";

/**
 * @param {string} importMetaUrl the module's own `import.meta.url`
 * @param {string[]} [argv] defaults to `process.argv`
 * @returns {boolean}
 */
export function isMainModule(importMetaUrl, argv = process.argv) {
  const entry = argv?.[1];
  if (typeof entry !== "string" || entry.length === 0) return false;
  try {
    return pathToFileURL(realpathSync(entry)).href === importMetaUrl;
  } catch {
    return false;
  }
}
