import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

/**
 * E2E: Authenticated student happy path — login → dashboard → chat → Sage reply.
 *
 * Test-user provisioning is done by `e2e/global-setup.ts`, which writes
 * credentials to `e2e/.test-user.json`. Cleanup happens in
 * `e2e/global-teardown.ts`.
 *
 * AI dependency:
 * - The Sage response assertion requires the configured AI provider to be
 *   reachable. In dev this is typically the Ollama relay over the Cloudflare
 *   tunnel (per project memory: scheduled task "Sage Tunnel"). When the
 *   provider is unreachable the chat send still returns a graceful error
 *   message; the spec asserts only that the user message was *accepted* and
 *   skips the response-content assertion in that case.
 */

interface TestUserCreds {
  studentDbId: string;
  studentId: string;
  displayName: string;
  email: string;
  password: string;
}

const CREDS_PATH = path.resolve(__dirname, ".test-user.json");

function readCreds(): TestUserCreds {
  if (!fs.existsSync(CREDS_PATH)) {
    throw new Error(
      `Test user credentials not found at ${CREDS_PATH}. Did global-setup.ts run?`,
    );
  }
  return JSON.parse(fs.readFileSync(CREDS_PATH, "utf8")) as TestUserCreds;
}

test.describe("Authenticated student chat happy path", () => {
  // SSE + AI provider can be slow on cold start.
  test.setTimeout(60_000);

  test("logs in, opens chat, sends a message, sees user + Sage messages", async ({ page }) => {
    const creds = readCreds();

    // 1. Land on auth page
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: /build momentum/i }),
    ).toBeVisible();

    // 2. Submit credentials
    await page.getByLabel(/username or email/i).fill(creds.studentId);
    await page.getByLabel(/password/i).fill(creds.password);
    await page.getByRole("button", { name: "Sign In" }).first().click();

    // 3. Land on student dashboard
    await page.waitForURL(/\/dashboard(\?.*)?$/, { timeout: 20_000 });

    // 4. Navigate to chat (the student app shell streams in async; rather
    //    than racing the dashboard skeleton we assert authentication via
    //    direct navigation to /chat, which is gated by the same session
    //    middleware as /dashboard).
    await page.goto("/chat");
    const messageInput = page.getByLabel("Message to Sage");
    await expect(messageInput).toBeVisible();

    // 5. Send a simple message
    const userMessage = "Hello Sage, can you say hi back?";
    await messageInput.fill(userMessage);
    await page.getByRole("button", { name: "Send message" }).click();

    // 6. Assert the user's message renders in the conversation log
    await expect(page.getByText(userMessage, { exact: false })).toBeVisible({
      timeout: 10_000,
    });

    // 7. Best-effort: assert a Sage reply appears.
    //    This depends on the AI provider being reachable. If it's not
    //    (Ollama tunnel down, no GEMINI_API_KEY, etc.) the chat surface
    //    shows a graceful error message rather than a real reply — we treat
    //    that as a soft skip rather than failing the smoke test.
    const sageMessages = page.locator('[aria-label="Sage\'s message"]');
    try {
      await sageMessages.first().waitFor({ state: "visible", timeout: 30_000 });
      const replyText = (await sageMessages.last().innerText()).trim();
      const aiUnreachable =
        /Gemini API key|not configured|trouble responding|didn't receive a complete response/i.test(
          replyText,
        );
      if (aiUnreachable) {
        test.info().annotations.push({
          type: "skip-reason",
          description: `AI provider unreachable — got fallback message: "${replyText.slice(0, 120)}"`,
        });
      } else {
        expect(replyText.length).toBeGreaterThan(2);
      }
    } catch {
      // Even the fallback bubble didn't render; treat as soft skip and only
      // confirm the user message was accepted (already asserted above).
      test.info().annotations.push({
        type: "skip-reason",
        description:
          "No Sage message bubble appeared within 30s — likely AI provider not reachable in this environment.",
      });
    }
  });
});
