import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-32-chars-minimum-ok!!";

let createConfirmationToken: typeof import("./confirmation").createConfirmationToken;
let verifyConfirmationToken: typeof import("./confirmation").verifyConfirmationToken;
let confirmationTokenExpiry: typeof import("./confirmation").confirmationTokenExpiry;

before(async () => {
  ({ createConfirmationToken, verifyConfirmationToken, confirmationTokenExpiry } =
    await import("./confirmation"));
});

const payload = {
  toolName: "submit_form",
  args: { fileUploadId: "file-1", orientationItemId: "item-1" },
  sessionId: "stu-1",
  conversationId: "conv-1",
};

const NOW = new Date("2026-06-10T12:00:00Z");

describe("confirmation tokens", () => {
  it("round-trips for the identical payload", () => {
    const token = createConfirmationToken(payload, NOW);
    assert.equal(verifyConfirmationToken(token, payload, NOW), true);
  });

  it("is insensitive to args key order (canonical JSON)", () => {
    const token = createConfirmationToken(payload, NOW);
    const reordered = {
      ...payload,
      args: { orientationItemId: "item-1", fileUploadId: "file-1" },
    };
    assert.equal(verifyConfirmationToken(token, reordered, NOW), true);
  });

  it("round-trips for a staff-assisted payload carrying targetStudentId", () => {
    const staffPayload = { ...payload, targetStudentId: "stu-target-1" };
    const token = createConfirmationToken(staffPayload, NOW);
    assert.equal(verifyConfirmationToken(token, staffPayload, NOW), true);
  });

  it("rejects a payload that re-splits field content across the old |-boundaries", () => {
    // Both payloads joined to the identical "stu-1|evil|conv-1" segment under
    // the previous |-delimited signature input — the delimiter inside a field
    // value made the boundary ambiguous.
    const shifted = {
      ...payload,
      sessionId: "stu-1|evil",
      conversationId: "conv-1",
    };
    const original = { ...payload, sessionId: "stu-1", conversationId: "evil|conv-1" };
    assert.equal(
      [original.sessionId, original.conversationId].join("|"),
      [shifted.sessionId, shifted.conversationId].join("|"),
    );

    const token = createConfirmationToken(original, NOW);
    assert.equal(verifyConfirmationToken(token, shifted, NOW), false);
  });

  it("distinguishes an absent targetStudentId from an empty-string one", () => {
    const emptyTarget = { ...payload, targetStudentId: "" };
    assert.notEqual(
      createConfirmationToken(payload, NOW),
      createConfirmationToken(emptyTarget, NOW),
    );

    const token = createConfirmationToken(payload, NOW);
    assert.equal(verifyConfirmationToken(token, emptyTarget, NOW), false);
  });

  it("signs a payload field named expiresAt distinctly from the token expiry", () => {
    // If ConfirmationPayload ever grows an expiresAt field, it must be bound
    // into the HMAC — not shadowed by the token-expiry entry.
    const withField = { ...payload, expiresAt: 1 } as unknown as typeof payload;
    assert.notEqual(
      createConfirmationToken(withField, NOW),
      createConfirmationToken(payload, NOW),
    );
  });

  it("signs undefined array elements as null, like JSON.stringify", () => {
    const withUndefined = { ...payload, args: { list: [undefined] } };
    assert.notEqual(
      createConfirmationToken(withUndefined, NOW),
      createConfirmationToken({ ...payload, args: { list: [] } }, NOW),
    );
    assert.equal(
      createConfirmationToken(withUndefined, NOW),
      createConfirmationToken({ ...payload, args: { list: [null] } }, NOW),
    );
  });

  it("treats an explicitly-undefined targetStudentId as absent", () => {
    const token = createConfirmationToken(payload, NOW);
    assert.equal(
      verifyConfirmationToken(token, { ...payload, targetStudentId: undefined }, NOW),
      true,
    );
  });

  it("rejects any tampering with tool, args, session, or conversation", () => {
    const token = createConfirmationToken(payload, NOW);
    assert.equal(
      verifyConfirmationToken(token, { ...payload, toolName: "file_document" }, NOW),
      false,
    );
    assert.equal(
      verifyConfirmationToken(token, { ...payload, args: { ...payload.args, fileUploadId: "file-2" } }, NOW),
      false,
    );
    assert.equal(verifyConfirmationToken(token, { ...payload, sessionId: "stu-2" }, NOW), false);
    assert.equal(
      verifyConfirmationToken(token, { ...payload, conversationId: "conv-2" }, NOW),
      false,
    );
    assert.equal(
      verifyConfirmationToken(token, { ...payload, targetStudentId: "stu-other" }, NOW),
      false,
    );
  });

  it("expires after the TTL", () => {
    const token = createConfirmationToken(payload, NOW);
    const later = new Date(NOW.getTime() + 11 * 60 * 1000);
    assert.equal(verifyConfirmationToken(token, payload, later), false);
  });

  it("rejects malformed tokens", () => {
    assert.equal(verifyConfirmationToken("garbage", payload, NOW), false);
    assert.equal(verifyConfirmationToken("123.deadbeef", payload, NOW), false);
  });
});

describe("confirmationTokenExpiry", () => {
  it("reads the expiry a created token was stamped with (TTL = 10 min)", () => {
    const token = createConfirmationToken(payload, NOW);
    assert.equal(confirmationTokenExpiry(token)?.getTime(), NOW.getTime() + 10 * 60 * 1000);
  });

  it("returns null when the prefix does not parse", () => {
    assert.equal(confirmationTokenExpiry("no-separator"), null);
    assert.equal(confirmationTokenExpiry("notanumber.deadbeef"), null);
  });
});
