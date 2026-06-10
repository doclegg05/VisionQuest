import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-32-chars-minimum-ok!!";

let createConfirmationToken: typeof import("./confirmation").createConfirmationToken;
let verifyConfirmationToken: typeof import("./confirmation").verifyConfirmationToken;

before(async () => {
  ({ createConfirmationToken, verifyConfirmationToken } = await import("./confirmation"));
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
