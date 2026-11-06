import assert from "node:assert/strict";
import { before, describe, it, mock } from "node:test";
import { renderToString } from "react-dom/server";

// Ruling R18: an invite link is a bearer link until Phase 2 Microsoft sign-in,
// so the accept page must not print or pre-fill the invited email. The person
// types it, and acceptance checks it against the invite.

const INVITED_EMAIL = "pat.instructor@example.org";

mock.module("@/lib/staff-invite-list", {
  exports: {
    // Shaped like the preview used to be, email included, so a page that
    // reads it again fails here.
    previewStaffInvite: async () => ({ email: INVITED_EMAIL, role: "teacher", regionName: "North" }),
  },
});
mock.module("next/navigation", {
  exports: { useRouter: () => ({ replace: () => {}, refresh: () => {} }) },
});
mock.module("@/components/ui/BrandLockup", { exports: { default: () => null } });

let Page: typeof import("./page").default;

before(async () => {
  Page = (await import("./page")).default;
});

describe("invite accept page", () => {
  it("never puts the invited email in the page", async () => {
    const html = renderToString(await Page({ params: Promise.resolve({ token: "tok" }) }));
    assert.ok(html.includes("Create my account"), "the form must render for this to mean anything");
    assert.ok(!html.includes(INVITED_EMAIL), "the accept page printed or pre-filled the invited email");
    assert.match(html, /id="accept-email"[^>]*value=""/);
  });
});
