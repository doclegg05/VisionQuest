import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { inviteNotice } from "./StaffInviteForm";

describe("inviteNotice", () => {
  it("confirms a sent invite", () => {
    assert.equal(inviteNotice("sent"), "Invite sent.");
  });

  it("says the send failed, distinct from email not being set up", () => {
    assert.equal(inviteNotice("failed"), "We could not send the email. Try again, or ask an admin.");
    assert.equal(
      inviteNotice("not_configured"),
      "Email is not set up. Copy this link and send it to the person yourself.",
    );
  });
});
