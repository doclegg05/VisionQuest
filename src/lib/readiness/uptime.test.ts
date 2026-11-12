import assert from "node:assert/strict";
import { it } from "node:test";
import { checkUptime } from "../../../scripts/readiness/uptime.mjs";

it("uptime fails when Sage is disconnected even while the app is healthy", async () => {
  await assert.rejects(checkUptime("https://example.test", async () => Response.json({ status: "healthy", sage: { connected: false } })));
});
it("uptime fails closed when an older app omits Sage's connection flag", async () => {
  await assert.rejects(checkUptime("https://example.test", async () => Response.json({ status: "healthy" })));
});
it("uptime passes only when the app and Sage connection are healthy", async () => {
  await checkUptime("https://example.test", async () => Response.json({ status: "healthy", sage: { connected: true } }));
});
