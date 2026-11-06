import assert from "node:assert/strict";
import { before, describe, it, mock } from "node:test";

// The coordinator layout is the door to /coordinator, which getRoleHomePath
// sends both coordinator roles to. A role the door refuses but the home path
// points at loops between the two forever.

class RedirectSignal extends Error {}

let session: { id: string; studentId: string; displayName: string; role: string } | null = null;

mock.module("@/lib/auth", { exports: { getSession: async () => session } });
mock.module("next/navigation", {
  exports: {
    redirect: (to: string) => {
      throw new RedirectSignal(to);
    },
  },
});
mock.module("@/components/ui/NavBar", { exports: { default: () => null } });
mock.module("@/components/ui/NotificationProvider", {
  exports: { default: ({ children }: { children: unknown }) => children },
});

let Layout: typeof import("./layout").default;

before(async () => {
  Layout = (await import("./layout")).default;
});

async function redirectFor(role: string): Promise<string | null> {
  session = { id: "u1", studentId: "u1", displayName: "U One", role };
  try {
    await Layout({ children: null });
    return null;
  } catch (error) {
    if (error instanceof RedirectSignal) return error.message;
    throw error;
  }
}

describe("coordinator layout", () => {
  for (const role of ["program_coordinator", "coordinator", "admin"]) {
    it(`admits ${role}`, async () => {
      assert.equal(await redirectFor(role), null);
    });
  }

  it("sends an instructor to their own home", async () => {
    assert.equal(await redirectFor("teacher"), "/teacher");
  });

  it("sends a student to their own home", async () => {
    assert.notEqual(await redirectFor("student"), null);
  });
});
