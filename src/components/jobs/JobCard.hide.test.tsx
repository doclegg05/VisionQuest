import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderToString } from "react-dom/server";
import { HIDE_ERROR_MESSAGE, JobCard, runHideAndDescribeError } from "./JobCard";
import { HIDDEN_LOAD_ERROR_MESSAGE, HiddenJobsPanel } from "./HiddenJobsPanel";

function renderCard(overrides?: Partial<Parameters<typeof JobCard>[0]>) {
  return renderToString(
    <JobCard
      id="job-1"
      title="Cashier"
      company="Kroger"
      location="Charleston, WV"
      workMode="onsite"
      salary={null}
      matchScore={0}
      matchLabel={null}
      clusters={[]}
      savedStatus={null}
      url="https://example.com/a"
      onSave={async () => undefined}
      {...(overrides ?? {})}
    />,
  );
}

const noop = async () => undefined;

function buttonFor(html: string, label: string): string {
  const match = html.match(new RegExp(`<button[^>]*aria-label="${label}"[^>]*>`));
  assert.ok(match, `a <button> labelled "${label}" renders`);
  return match[0];
}

describe("JobCard Not interested button", () => {
  it("renders a real 44px button with a plain label when hiding is on", () => {
    const html = renderCard({ onHide: noop });
    const button = buttonFor(html, "Not interested in Cashier");
    assert.match(button, /type="button"/);
    assert.match(button, /min-h-11/);
    assert.ok(html.includes("Not interested"));
  });

  it("is absent while hiding is off and in compact cards", () => {
    assert.equal(renderCard().includes("Not interested"), false);
    assert.equal(renderCard({ onHide: noop, compact: true }).includes("Not interested"), false);
  });

  it("gives the Save button an explicit button type", () => {
    assert.match(renderCard(), /<button type="button"[^>]*>(?:(?!<\/button>).)*Save/);
  });

  it("returns null on success and the plain message on failure", async () => {
    assert.equal(await runHideAndDescribeError(noop, "job-1"), null);
    const failing = async () => {
      throw new Error("500");
    };
    assert.equal(await runHideAndDescribeError(failing, "job-1"), HIDE_ERROR_MESSAGE);
  });
});

describe("HiddenJobsPanel", () => {
  const hiddenJobs = [{ id: "h1", snapshotTitle: "Cashier", snapshotCompany: "Kroger", snapshotLocation: "Charleston, WV" }];

  it("lists hidden jobs with a real 44px Restore button for each", () => {
    const html = renderToString(
      <HiddenJobsPanel state={{ hideEnabled: true, hiddenJobs, loadFailed: false }} onRestore={noop} />,
    );
    assert.ok(html.includes("Jobs you hid (1)"));
    const button = buttonFor(html, "Restore Cashier");
    assert.match(button, /type="button"/);
    assert.match(button, /min-h-11/);
  });

  it("renders nothing while hiding is off, even with stored rows", () => {
    const html = renderToString(
      <HiddenJobsPanel state={{ hideEnabled: false, hiddenJobs, loadFailed: false }} onRestore={noop} />,
    );
    assert.equal(html, "");
  });

  it("says so when the hidden list fails to load", () => {
    const html = renderToString(
      <HiddenJobsPanel state={{ hideEnabled: false, hiddenJobs: [], loadFailed: true }} onRestore={noop} />,
    );
    // renderToString escapes the apostrophe, so match the escaped form.
    assert.ok(html.includes(HIDDEN_LOAD_ERROR_MESSAGE.replace("'", "&#x27;")));
    assert.match(html, /role="alert"/);
  });
});
