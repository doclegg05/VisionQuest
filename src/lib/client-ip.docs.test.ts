/**
 * The owner check for the sign-in limits' client address (readiness A6b).
 *
 * Only production can say how many proxies sit in front of the app, so
 * DEPLOY.md carries one check the owner runs after a deploy. These tests pin
 * the parts that make it a real test: it judges the audit row's address by
 * EQUALITY with the owner's public address, its sign-in body uses the login
 * route's real field names, and render.yaml ships the same hop count as the
 * code's default.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { DEFAULT_TRUSTED_PROXY_HOPS } from "./client-ip";
import { loginSchema } from "./schemas";

const ROOT = path.resolve(__dirname, "../..");
const read = (file: string): string => readFileSync(path.join(ROOT, file), "utf8");

const HEADING = "### Check the sign-in limits' client address";

function ownerCheck(): string {
  const deploy = read("DEPLOY.md");
  const start = deploy.indexOf(HEADING);
  assert.notEqual(start, -1, `DEPLOY.md has no "${HEADING}" section`);
  const next = deploy.slice(start + HEADING.length).search(/\n##+ /u);
  return next === -1 ? deploy.slice(start) : deploy.slice(start, start + HEADING.length + next);
}

describe("DEPLOY.md owner check for the client address", () => {
  it("judges the audit row's address by equality with the owner's public address", () => {
    const check = ownerCheck();
    assert.match(check, /curl -4 https:\/\/ifconfig\.me/u);
    assert.match(check, /curl -6 https:\/\/ifconfig\.me/u);
    assert.match(check, /\*\*Equal to the address from step 1\*\*: correct\./u);
    assert.match(check, /\*\*`203\.0\.113\.9`\*\*: the address can be forged\. Block launch/u);
    assert.match(check, /A Cloudflare address\*\*: `TRUSTED_PROXY_HOPS` is too low/u);
  });

  it("forges the header the check reads and signs in with the login route's own field names", () => {
    const check = ownerCheck();
    assert.match(check, /-H 'X-Forwarded-For: 203\.0\.113\.9'/u);
    const body = check.match(/-d '(\{[^']+\})'/u)?.[1];
    assert.ok(body, "the sign-in command carries a JSON body");
    const parsed = loginSchema.safeParse(JSON.parse(body));
    assert.ok(parsed.success, "the body passes the login route's schema");
    assert.deepEqual(Object.keys(JSON.parse(body)).sort(), Object.keys(loginSchema.shape).sort());
  });

  it("reads the failed sign-in rows and checks the fake login left only its hash", () => {
    const check = ownerCheck();
    assert.match(
      check,
      /SELECT "createdAt", metadata FROM visionquest\."AuditLog" WHERE action LIKE 'auth\.login_failed%' ORDER BY "createdAt" DESC LIMIT 3;/u,
    );
    assert.match(check, /metadata\.loginHash/u);
    assert.match(check, /zz-address-check-0001` appears nowhere/u);
  });
});

describe("render.yaml ships the code's trusted hop count", () => {
  it("sets TRUSTED_PROXY_HOPS to the default", () => {
    const value = read("render.yaml").match(/- key: TRUSTED_PROXY_HOPS\n\s+value: "(\d+)"/u)?.[1];
    assert.equal(Number(value), DEFAULT_TRUSTED_PROXY_HOPS);
    assert.equal(DEFAULT_TRUSTED_PROXY_HOPS, 2);
  });
});
