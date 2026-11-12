/**
 * The boot refuses a proxy setting it cannot read (readiness A6).
 *
 * `TRUSTED_PROXY_HOPS` and `CLOUDFLARE_IN_FRONT` decide which header hop every
 * per-network rate limit counts. A typo read as a default would quietly trust
 * the wrong hop, so `validateRuntimeEnv` refuses it the way it refuses a
 * malformed database URL.
 */

import assert from "node:assert/strict";
import { afterEach, before, describe, it } from "node:test";

process.env.DATABASE_URL ??= "postgresql://user:pass@127.0.0.1:5432/visionquest_test";
process.env.JWT_SECRET ??= "a-test-jwt-secret-that-is-long-enough-for-boot";
process.env.API_KEY_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");
process.env.APP_BASE_URL ??= "http://localhost:3000";

let validateRuntimeEnv: () => void;

before(async () => {
  ({ validateRuntimeEnv } = await import("./env"));
});

describe("validateRuntimeEnv and the client address settings", () => {
  afterEach(() => {
    delete process.env.TRUSTED_PROXY_HOPS;
    delete process.env.CLOUDFLARE_IN_FRONT;
  });

  it("accepts the settings unset", () => {
    assert.doesNotThrow(() => validateRuntimeEnv());
  });

  it("refuses a trusted proxy count it cannot read", () => {
    process.env.TRUSTED_PROXY_HOPS = "one";
    assert.throws(() => validateRuntimeEnv(), /TRUSTED_PROXY_HOPS/);
  });

  it("refuses a Cloudflare setting that is not true or false", () => {
    process.env.CLOUDFLARE_IN_FRONT = "yes";
    assert.throws(() => validateRuntimeEnv(), /CLOUDFLARE_IN_FRONT/);
  });
});
