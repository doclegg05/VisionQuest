import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assessReadability } from "@/lib/sage/readability";
import {
  STAFF_INVITE_MESSAGES,
  STAFF_INVITE_REASONS,
  staffInviteStatus,
} from "@/lib/staff-invite-messages";

describe("staff invite messages", () => {
  it("has one plain message for every refusal reason", () => {
    for (const reason of STAFF_INVITE_REASONS) {
      assert.ok(STAFF_INVITE_MESSAGES[reason], `no message for ${reason}`);
      assert.ok(staffInviteStatus(reason) >= 400, `no status for ${reason}`);
    }
    assert.deepEqual(Object.keys(STAFF_INVITE_MESSAGES).sort(), [...STAFF_INVITE_REASONS].sort());
  });

  it("keeps each message at about a 6th-grade reading level", () => {
    for (const reason of STAFF_INVITE_REASONS) {
      const result = assessReadability(STAFF_INVITE_MESSAGES[reason]);
      assert.ok(result.grade <= 8, `${reason} reads at grade ${result.grade}`);
    }
  });

  it("uses the region wording the brief asks for", () => {
    assert.equal(STAFF_INVITE_MESSAGES.region_not_allowed, "You can invite people only to your own region.");
  });
});
