/**
 * Pure planning logic for scripts/memory-pseudonymize-backfill.mjs — no
 * database, no network. Tested via a sibling test file in this directory.
 *
 * `src/lib/sage/memory/store.ts` pseudonymises `content` at WRITE time
 * (`[STUDENT_NAME]`, `[EMAIL_n]`, …). Rows stored before that shipped hold
 * the raw name; their `sourceHash` (computed over the STORED text) no longer
 * matches the pseudonymised twin a later turn extracts, so the pair can
 * double-store — same fact, one row readable, one tokenized. This module
 * decides, for one subject's full set of active memory rows, what to do
 * about it:
 *
 *  - "unchanged"  — pseudonymize(content) === content (nothing to catch, or
 *                   the row is already pseudonymized and idempotent under a
 *                   second pass)
 *  - "rewrite"    — pseudonymize(content) !== content and no other row for
 *                   this subject lands on the same final content
 *  - "dedupe"     — this row's final content (raw, pseudonymized, or
 *                   already-pseudonymized) collides with another row's; the
 *                   OLDER of the colliding rows is dropped as the twin the
 *                   review predicted, and the newer one is kept (rewritten
 *                   if it still needs it, unchanged if it doesn't)
 *
 * Given the SAME real `TokenVault`/`sourceHashFor` production code runs
 * here as at write time (imported, not reimplemented), this planner is
 * exactly as faithful to production behavior as store.ts itself — including
 * the substitution ORDER (contact values before names) that a home-rolled
 * re-implementation could silently regress.
 */

// Dynamic + destructured, not a static `import { X } from "....ts"`: this
// project has no `"type": "module"` in package.json, so tsx transpiles a
// directly-`.ts`-imported module to CommonJS, and Node's static import
// analysis of that CJS output only ever resolves a `default` binding — a
// static named import throws `SyntaxError: does not provide an export
// named …` even though the export is really there. A dynamic `import()`
// resolves the same module at RUNTIME against its actual shape instead of
// via static analysis, and destructuring it then works. Same pattern
// `scripts/backfill-embeddings.mjs` already uses for its `src/lib` imports.
const { TokenVault } = await import("../../src/lib/ai/deidentify.ts");
const { DEIDENTIFY_ALLOWLIST } = await import("../../src/lib/ai/deidentify-allowlist.ts");
const { sourceHashFor } = await import("../../src/lib/sage/memory/schema.ts");

/**
 * @typedef {object} MemoryRow
 * @property {string} id
 * @property {string} subjectType
 * @property {string} subjectId
 * @property {string} content
 * @property {string} sourceHash
 * @property {Date} createdAt
 */

/**
 * @typedef {object} PlanAction
 * @property {"unchanged"|"rewrite"|"dedupe"} type
 * @property {string} id
 * @property {string} [content] rewrite only — the pseudonymized text
 * @property {string} [sourceHash] rewrite only — sourceHashFor the new content
 * @property {string} [keptId] dedupe only — the id of the row kept instead
 */

/**
 * Build the same vault store.ts builds at write time, from the identity
 * fields a caller already loaded for this subject.
 *
 * @param {import("../../src/lib/ai/deidentify.ts").IdentityInput} identity
 * @returns {TokenVault}
 */
export function buildVault(identity) {
  return TokenVault.fromIdentity(identity, { freeText: true, allowlist: DEIDENTIFY_ALLOWLIST });
}

/**
 * @param {readonly MemoryRow[]} rows every ACTIVE memory row for one subject
 *   (one subjectType/subjectId pair — the same scope the write-time advisory
 *   lock and hash pre-check use)
 * @param {import("../../src/lib/ai/deidentify.ts").IdentityInput} identity
 * @returns {PlanAction[]}
 */
export function planMemoryPseudonymization(rows, identity) {
  if (rows.length === 0) return [];

  const vault = buildVault(identity);

  // Pass 1: what each row's content and sourceHash would be AFTER
  // pseudonymization — computed once per row regardless of how many other
  // rows end up colliding with it.
  const computed = rows.map((row) => {
    const content = vault.pseudonymize(row.content);
    const changed = content !== row.content;
    const finalHash = changed
      ? sourceHashFor({ subjectType: row.subjectType, subjectId: row.subjectId, content })
      : row.sourceHash;
    return { row, content, changed, finalHash };
  });

  // Pass 2: group by final hash. A group of one is the common case
  // (rewrite-or-leave-alone); a group of more than one is the double-store
  // the review predicted — keep the NEWEST row, drop the rest.
  /** @type {Map<string, typeof computed>} */
  const groups = new Map();
  for (const entry of computed) {
    const list = groups.get(entry.finalHash);
    if (list) list.push(entry);
    else groups.set(entry.finalHash, [entry]);
  }

  /** @type {PlanAction[]} */
  const actions = [];
  for (const group of groups.values()) {
    const sorted =
      group.length === 1 ? group : [...group].sort((a, b) => b.row.createdAt.getTime() - a.row.createdAt.getTime());
    const [keep, ...drop] = sorted;

    actions.push(
      keep.changed
        ? { type: "rewrite", id: keep.row.id, content: keep.content, sourceHash: keep.finalHash }
        : { type: "unchanged", id: keep.row.id },
    );
    for (const entry of drop) {
      actions.push({ type: "dedupe", id: entry.row.id, keptId: keep.row.id });
    }
  }

  return actions;
}

/**
 * Tally a plan into the counts the CLI script prints — never a name, never
 * content.
 *
 * @param {readonly PlanAction[]} actions
 */
export function tallyPlan(actions) {
  let rewritten = 0;
  let deduped = 0;
  let unchanged = 0;
  for (const action of actions) {
    if (action.type === "rewrite") rewritten++;
    else if (action.type === "dedupe") deduped++;
    else unchanged++;
  }
  return { rewritten, deduped, unchanged };
}
