import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToString } from "react-dom/server";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";

import { MIN_PASSWORD_LENGTH } from "@/lib/password-policy";

import StaffRegisterPage from "./page";

/**
 * Staff registration told new staff "At least 8 characters" while the server
 * asked for 12. The hint must state the constant the server enforces.
 */

/** StaffRegisterPage calls useRouter(); the page never navigates while it renders. */
const router: AppRouterInstance = {
  push: () => {},
  replace: () => {},
  refresh: () => {},
  back: () => {},
  forward: () => {},
  prefetch: () => {},
  bfcacheId: "test",
};

/** The hint drawn inside the staff registration password field. */
function passwordHint(): string {
  const html = renderToString(
    <AppRouterContext.Provider value={router}>
      <StaffRegisterPage />
    </AppRouterContext.Provider>,
  );
  const field = html.match(/<input\b[^>]*\bid="password"[^>]*>/u)?.[0];
  assert.ok(field, "no password field on the staff registration page");
  return field.match(/placeholder="([^"]*)"/u)?.[1] ?? "";
}

describe("staff registration: password hint", () => {
  it("states the length the server enforces, and no other number", () => {
    const stated = [...passwordHint().matchAll(/\d+/gu)].map((match) => Number(match[0]));

    assert.deepEqual(stated, [MIN_PASSWORD_LENGTH]);
  });
});
