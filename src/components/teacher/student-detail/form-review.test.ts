import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import {
  buildFormReviewBody,
  counterSignApproval,
  reviewResultMessage,
  type FormReviewExtras,
  type FormReviewHandler,
  type SignaturePadResult,
} from "./form-review";

const SIGNATURE: SignaturePadResult = {
  signatureDataUrl: "data:image/png;base64,aGVsbG8=",
  signatureName: "Dana Reeves",
  signatureMethod: "drawn",
};

const EXTRAS: FormReviewExtras = {
  staffSignatureDataUrl: SIGNATURE.signatureDataUrl,
  staffSignatureName: SIGNATURE.signatureName,
  staffSignatureMethod: SIGNATURE.signatureMethod,
};

describe("buildFormReviewBody", () => {
  it("sends the submission, the status and the notes", () => {
    const body = buildFormReviewBody("sub-1", "rejected", "Missing page 2");
    assert.deepEqual(body, {
      submissionId: "sub-1",
      status: "rejected",
      notes: "Missing page 2",
    });
  });

  // H3. The counter-signature is captured by the signature pad and has to
  // reach the route on the approval request itself. When it travelled on a
  // separate PATCH, the approval PATCH that followed carried no signature
  // fields and undid it.
  it("carries the staff counter-signature when one was captured", () => {
    const body = buildFormReviewBody("sub-1", "approved", "", EXTRAS);
    assert.equal(body.staffSignatureDataUrl, SIGNATURE.signatureDataUrl);
    assert.equal(body.staffSignatureName, "Dana Reeves");
    assert.equal(body.staffSignatureMethod, "drawn");
  });

  it("sends no signature fields when nothing was captured", () => {
    const body = buildFormReviewBody("sub-1", "approved", "");
    assert.ok(!("staffSignatureDataUrl" in body));
    assert.ok(!("staffSignatureName" in body));
    assert.ok(!("staffSignatureMethod" in body));
  });

  // The route defaults an unsupplied title to null rather than inventing
  // one, so the client must not send a job title nobody typed.
  it("never invents a signer title", () => {
    const body = buildFormReviewBody("sub-1", "approved", "", EXTRAS);
    assert.ok(!("staffSignatureTitle" in body));
  });
});

const noopHandler: FormReviewHandler = async () => {};

describe("counterSignApproval", () => {
  let fetchCalls: number;
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    fetchCalls = 0;
    globalThis.fetch = (async () => {
      fetchCalls += 1;
      return new Response("{}", { status: 200 });
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  // H3. The flow used to PATCH the route with the signature and then call
  // onReviewForm, which PATCHed the same route again without it: two audit
  // rows for one approval, the second contradicting the first, and — while
  // the route still regenerated the packet — the instructor's signature
  // overwritten with null seconds after it was drawn.
  it("issues exactly one approval request", async () => {
    const reviewForm = mock.fn(noopHandler);
    await counterSignApproval("student-1", "sub-1", SIGNATURE, reviewForm);

    assert.equal(reviewForm.mock.callCount(), 1);
    assert.equal(fetchCalls, 0, "counterSignApproval must not issue its own PATCH");
  });

  it("hands the captured signature to the review handler", async () => {
    const reviewForm = mock.fn(noopHandler);
    await counterSignApproval("student-1", "sub-1", SIGNATURE, reviewForm);

    const [submissionId, status, extras] = reviewForm.mock.calls[0].arguments;
    assert.equal(submissionId, "sub-1");
    assert.equal(status, "approved");
    assert.deepEqual(extras, EXTRAS);
  });

  it("propagates a failed approval instead of reporting success", async () => {
    const reviewForm = async () => {
      throw new Error("network down");
    };
    await assert.rejects(
      () => counterSignApproval("student-1", "sub-1", SIGNATURE, reviewForm),
      /network down/,
    );
  });
});

describe("reviewResultMessage", () => {
  it("reports a return for revision", () => {
    assert.equal(reviewResultMessage("rejected", undefined, {}), "Form returned for revision.");
  });

  it("reports a plain approval when nothing was counter-signed", () => {
    assert.equal(reviewResultMessage("approved", undefined, {}), "Form approved.");
  });

  it("confirms the counter-signature only when the route says it was recorded", () => {
    assert.match(
      reviewResultMessage("approved", EXTRAS, { counterSignatureRecorded: true }),
      /counter-signature was recorded/,
    );
  });

  // The audit row is the only place the signature is kept. If that write
  // failed the instructor must not be told the packet is counter-signed.
  it("says the counter-signature was NOT recorded when the route reports a failed audit write", () => {
    assert.match(
      reviewResultMessage("approved", EXTRAS, { audited: false, counterSignatureRecorded: false }),
      /was not recorded/,
    );
  });
});
