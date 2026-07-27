// =============================================================================
// VQ-R-016 — the save handlers ignored !res.ok, so a failed save looked like
// nothing happened. postJobSave is the shared fetch path for JobBoardWidget /
// CareerHub: it sends the right id field for the listing kind and reports a
// student-readable error instead of swallowing failures.
// =============================================================================
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { postJobSave } from "./save-job-client";

type FetchImpl = typeof fetch;

function fetchResponding(status: number, body: unknown): FetchImpl {
  return (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    })) as FetchImpl;
}

describe("postJobSave (VQ-R-016)", () => {
  it("sends jobListingId for class rows and reports ok", async () => {
    let captured: { url: string; body: Record<string, unknown> } | null = null;
    const fetchImpl: FetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      captured = { url: String(input), body: JSON.parse(String(init?.body)) };
      return new Response(JSON.stringify({ application: { id: "app-1" } }), { status: 200 });
    }) as FetchImpl;

    const result = await postJobSave("job-1", { status: "saved" }, "class", fetchImpl);

    assert.deepEqual(result, { ok: true, error: null });
    assert.equal(captured!.url, "/api/jobs/save");
    assert.deepEqual(captured!.body, { jobListingId: "job-1", status: "saved" });
  });

  it("sends browseListingId for browse rows", async () => {
    let capturedBody: Record<string, unknown> | null = null;
    const fetchImpl: FetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedBody = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ application: { id: "app-1" } }), { status: 200 });
    }) as FetchImpl;

    await postJobSave("browse-9", { status: "applied", notes: "sent" }, "browse", fetchImpl);

    assert.deepEqual(capturedBody, {
      browseListingId: "browse-9",
      status: "applied",
      notes: "sent",
    });
  });

  it("surfaces the server's error message on a non-OK response", async () => {
    const result = await postJobSave(
      "job-1",
      { status: "saved" },
      "class",
      fetchResponding(400, { error: "Job listing not found" }),
    );

    assert.equal(result.ok, false);
    assert.equal(result.error, "Job listing not found");
  });

  it("falls back to a readable message when the error body is unusable", async () => {
    const fetchImpl: FetchImpl = (async () => new Response("<html>oops</html>", { status: 500 })) as FetchImpl;

    const result = await postJobSave("job-1", undefined, "class", fetchImpl);

    assert.equal(result.ok, false);
    assert.ok(result.error && result.error.length > 0);
    assert.doesNotMatch(result.error, /html/i);
  });

  it("reports a connection problem when fetch itself throws", async () => {
    const fetchImpl: FetchImpl = (async () => {
      throw new TypeError("Failed to fetch");
    }) as FetchImpl;

    const result = await postJobSave("job-1", { status: "saved" }, "class", fetchImpl);

    assert.equal(result.ok, false);
    assert.match(result.error ?? "", /connection/i);
  });

  it("defaults an unknown kind to the class id field (back-compat)", async () => {
    let capturedBody: Record<string, unknown> | null = null;
    const fetchImpl: FetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedBody = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({}), { status: 200 });
    }) as FetchImpl;

    await postJobSave("job-1", { status: "saved" }, undefined, fetchImpl);

    assert.deepEqual(capturedBody, { jobListingId: "job-1", status: "saved" });
  });
});
