import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToString } from "react-dom/server";
import { ADMIN_INVITE_ROLES } from "./invite-roles";
import { StaffInviteForm } from "./StaffInviteForm";

// UX review of readiness B1, 2026-11-10: the invite form starts on the first
// role in its list, and the admin's list began with program coordinator. An
// admin who typed an email and pressed Send invite gave that person the whole
// state, with no region asked for.
describe("the roles an admin can invite", () => {
  it("start with the role that sees the least and end with the one that sees every region", () => {
    assert.deepEqual([...ADMIN_INVITE_ROLES], ["teacher", "coordinator", "program_coordinator"]);
  });

  it("open the invite form on Instructor, with the region asked for", () => {
    const html = renderToString(
      <StaffInviteForm roles={ADMIN_INVITE_ROLES} regions={[{ id: "region-1", name: "North" }]} onCreated={() => {}} />,
    );
    const selected = html.match(/<option[^>]*selected=""[^>]*>([^<]*)</g) ?? [];
    assert.ok(selected.some((option) => option.includes("Instructor")), html);
    assert.ok(!selected.some((option) => option.includes("Program coordinator")), html);
    assert.ok(html.includes("North"), "the region field shows for an instructor");
  });
});
