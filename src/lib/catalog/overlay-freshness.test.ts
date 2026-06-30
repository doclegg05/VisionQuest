import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { describe, it } from "node:test";
import { buildFormRoutingOverlay } from "./sync";
import { parseCatalogNode } from "./parse";

// config/form-routing.generated.json is a GENERATED artifact, but unlike the
// old (reverted) design it is no longer a throwaway local file — it ships to
// prod as the data source for answer-time form disambiguation (src/lib/catalog/
// notes.ts -> search_forms modelHint + getDirectFormAnswer bypass). Nothing in
// the build/CI regenerates it (Render does a fresh `npm ci` with no
// catalog:sync), and every consumer degrades silently when it's absent. So if
// it isn't committed and kept in sync with the catalog, the whole feature goes
// dark in prod with zero error signal. These tests are that guardrail.

const OVERLAY_PATH = "config/form-routing.generated.json";
const FORMS_DIR = "catalog/forms";

function loadApprovedFormNodes() {
  return readdirSync(FORMS_DIR)
    .filter((file) => file.endsWith(".md") && file !== "index.md")
    .map((file) => parseCatalogNode(readFileSync(`${FORMS_DIR}/${file}`, "utf8"), `${FORMS_DIR}/${file}`))
    .filter((node) => node.frontmatter.vq_status === "approved");
}

describe("form-routing overlay freshness", () => {
  it("is committed (the answer-time feature silently ships dark without it)", () => {
    assert.ok(
      existsSync(OVERLAY_PATH),
      `${OVERLAY_PATH} must be committed — it feeds answer-time disambiguation in prod`,
    );
  });

  it("matches what catalog:sync would regenerate from the catalog source", () => {
    const expected = buildFormRoutingOverlay(loadApprovedFormNodes());
    const committed = JSON.parse(readFileSync(OVERLAY_PATH, "utf8"));
    assert.deepEqual(
      committed,
      expected,
      "config/form-routing.generated.json is stale — re-run `npm run catalog:sync -- --overlay-only` and commit the result",
    );
  });
});
