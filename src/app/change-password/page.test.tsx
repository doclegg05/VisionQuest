import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import { renderToString } from "react-dom/server";

// The change-password screen (readiness A3). src/proxy.ts sends every page a
// held session asks for to this one, so this page must take whoever arrives
// and never send a held student anywhere the proxy would only send back.
// It lives outside the (student) route group for the same reason
// /recovery-setup does: that layout's own redirects cannot loop through it.

class RedirectSignal extends Error {}

interface TestSession {
  id: string;
  studentId: string;
  displayName: string;
  role: string;
  demoAccount?: "student" | "instructor";
  mustChangePassword?: true;
}

let session: TestSession | null;

mock.module("@/lib/auth", { exports: { getSession: async () => session } });

mock.module("next/navigation", {
  exports: {
    redirect: (to: string) => {
      throw new RedirectSignal(to);
    },
  },
});

mock.module("@/components/settings/ChangePasswordScreen", {
  exports: { ChangePasswordScreen: () => <p>the change password screen</p> },
});

let Page: typeof import("./page").default;

before(async () => {
  Page = (await import("./page")).default;
});

async function redirectTarget(): Promise<string | null> {
  try {
    await Page();
    return null;
  } catch (error) {
    if (error instanceof RedirectSignal) return error.message;
    throw error;
  }
}

describe("change password page", () => {
  beforeEach(() => {
    session = { id: "stu-1", studentId: "student1", displayName: "Test Student", role: "student", mustChangePassword: true };
  });

  it("shows the screen to a student who must change their password", async () => {
    assert.equal(await redirectTarget(), null);

    const html = renderToString(await Page());
    assert.ok(html.includes("the change password screen"));
    assert.match(html, /<main[^>]*id="main-content"/u);
  });

  it("sends a student with nothing to change to Settings, where the same form lives", async () => {
    session = { id: "stu-1", studentId: "student1", displayName: "Test Student", role: "student" };

    assert.equal(await redirectTarget(), "/settings");
  });

  it("sends a signed-out visitor to the sign-in page, which the proxy lets a held session reach", async () => {
    session = null;

    assert.equal(await redirectTarget(), "/");
  });

  it("sends staff to their own home", async () => {
    for (const [role, home] of [["teacher", "/teacher"], ["admin", "/admin"], ["coordinator", "/coordinator"]] as const) {
      session = { id: "staff-1", studentId: "staff", displayName: "Staff", role };
      assert.equal(await redirectTarget(), home, role);
    }
  });

  it("sends a demo student on to the dashboard: there is no password to change", async () => {
    session = { id: "stu-1", studentId: "student1", displayName: "Test Student", role: "student", demoAccount: "student" };

    assert.equal(await redirectTarget(), "/dashboard");
  });
});
