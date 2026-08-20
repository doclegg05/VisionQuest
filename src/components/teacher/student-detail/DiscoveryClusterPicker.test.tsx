import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderToString } from "react-dom/server";

import { CAREER_CLUSTERS } from "@/lib/spokes/career-clusters";
import {
  CLUSTER_SELECT_ID,
  DiscoveryClusterPicker,
  needsPathwayCluster,
  submitPathwayCluster,
} from "./DiscoveryClusterPicker";

/** Server-rendered markup escapes `&`, and several cluster labels carry one. */
function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * The button's className contains `disabled:opacity-50`, so a bare
 * `includes("disabled")` is always true. Only the real attribute counts.
 */
const DISABLED_ATTR = 'disabled=""';

const baseProps = {
  value: "",
  onChange: () => {},
  onConfirm: () => {},
  saving: false,
  error: null,
  savedClusterId: null,
};

describe("needsPathwayCluster", () => {
  it("is true for the awaiting_cluster state: complete discovery, no cluster", () => {
    assert.equal(needsPathwayCluster({ status: "complete", topClusters: [] }), true);
  });

  it("is false once a cluster exists", () => {
    assert.equal(needsPathwayCluster({ status: "complete", topClusters: ["office-admin"] }), false);
  });

  it("is false while discovery is still running", () => {
    assert.equal(needsPathwayCluster({ status: "in_progress", topClusters: [] }), false);
    assert.equal(needsPathwayCluster({ status: "not_started", topClusters: [] }), false);
  });

  it("is false when the student has no discovery record at all", () => {
    assert.equal(needsPathwayCluster(null), false);
  });
});

describe("DiscoveryClusterPicker rendering", () => {
  it("wires a visible label to the select", () => {
    const html = renderToString(<DiscoveryClusterPicker {...baseProps} />);

    assert.ok(
      html.includes(`for="${CLUSTER_SELECT_ID}"`),
      "expected a label bound to the select id",
    );
    assert.ok(html.includes(`id="${CLUSTER_SELECT_ID}"`), "expected the select to carry that id");
    assert.ok(html.includes("Career pathway"), "expected visible label text");
  });

  it("offers every SPOKES career cluster", () => {
    const html = renderToString(<DiscoveryClusterPicker {...baseProps} />);

    for (const cluster of CAREER_CLUSTERS) {
      assert.ok(html.includes(`value="${cluster.id}"`), `missing option for ${cluster.id}`);
      assert.ok(html.includes(escapeHtml(cluster.label)), `missing label for ${cluster.id}`);
    }
  });

  it("keeps the select and the save button at a 44px touch target", () => {
    const html = renderToString(<DiscoveryClusterPicker {...baseProps} />);

    const targets = html.match(/min-h-\[44px\]/g) ?? [];
    assert.ok(targets.length >= 2, `expected select + button at 44px, found ${targets.length}`);
  });

  it("disables saving until a pathway is chosen", () => {
    const html = renderToString(<DiscoveryClusterPicker {...baseProps} />);

    assert.ok(html.includes(DISABLED_ATTR), "expected the save button disabled with no selection");
  });

  it("enables saving once a pathway is chosen", () => {
    const html = renderToString(
      <DiscoveryClusterPicker {...baseProps} value="office-admin" />,
    );

    assert.ok(!html.includes(DISABLED_ATTR), "expected the save button enabled");
  });

  it("shows a saving state instead of a second submit", () => {
    const html = renderToString(
      <DiscoveryClusterPicker {...baseProps} value="office-admin" saving />,
    );

    assert.ok(html.includes("Saving"));
    assert.ok(html.includes(DISABLED_ATTR), "expected the button disabled while saving");
  });

  it("announces a save failure to assistive tech", () => {
    const html = renderToString(
      <DiscoveryClusterPicker {...baseProps} error="Could not save the pathway." />,
    );

    assert.ok(html.includes("Could not save the pathway."));
    assert.ok(html.includes('role="alert"'), "expected the error in an alert region");
  });

  it("replaces the form with the saved pathway once it lands", () => {
    const html = renderToString(
      <DiscoveryClusterPicker {...baseProps} savedClusterId="office-admin" />,
    );

    assert.ok(html.includes("Office &amp; Administrative Support"));
    assert.ok(!html.includes("<select"), "expected the picker to close after saving");
  });
});

describe("submitPathwayCluster", () => {
  function fetchStub(impl: () => Promise<Response>) {
    const calls: { input: RequestInfo | URL; init?: RequestInit }[] = [];
    const stub = (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ input, init });
      return impl();
    };
    return Object.assign(stub as typeof fetch, { calls });
  }

  it("PATCHes the discovery override route with the chosen cluster", async () => {
    const fetchFn = fetchStub(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));

    const result = await submitPathwayCluster("student-1", "office-admin", fetchFn);

    assert.deepEqual(result, { ok: true });
    assert.equal(fetchFn.calls[0].input, "/api/teacher/students/student-1/discovery");
    assert.equal(fetchFn.calls[0].init?.method, "PATCH");
    assert.deepEqual(JSON.parse(String(fetchFn.calls[0].init?.body)), {
      status: "complete",
      clusterId: "office-admin",
    });
  });

  it("surfaces the route's error message", async () => {
    const fetchFn = fetchStub(
      async () =>
        new Response(JSON.stringify({ error: "clusterId must be a known SPOKES career cluster id" }), {
          status: 400,
        }),
    );

    const result = await submitPathwayCluster("student-1", "nope", fetchFn);

    assert.deepEqual(result, {
      ok: false,
      error: "clusterId must be a known SPOKES career cluster id",
    });
  });

  it("returns a readable failure instead of throwing when the network drops", async () => {
    const fetchFn = fetchStub(async () => {
      throw new Error("network down");
    });

    const result = await submitPathwayCluster("student-1", "office-admin", fetchFn);

    assert.equal(result.ok, false);
    assert.ok(!result.ok && result.error.length > 0);
  });
});
