import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import { isOnetConfigured, onetCredentials } from "@/lib/career/onet-config";

describe("onet-config", () => {
  const prevUser = process.env.ONET_USERNAME;
  const prevPass = process.env.ONET_PASSWORD;
  const prevApiKey = process.env.ONET_API_KEY;

  beforeEach(() => {
    delete process.env.ONET_USERNAME;
    delete process.env.ONET_PASSWORD;
    delete process.env.ONET_API_KEY;
  });

  afterEach(() => {
    if (prevUser === undefined) delete process.env.ONET_USERNAME;
    else process.env.ONET_USERNAME = prevUser;
    if (prevPass === undefined) delete process.env.ONET_PASSWORD;
    else process.env.ONET_PASSWORD = prevPass;
    if (prevApiKey === undefined) delete process.env.ONET_API_KEY;
    else process.env.ONET_API_KEY = prevApiKey;
  });

  it("reports unconfigured when env missing", () => {
    assert.equal(isOnetConfigured(), false);
    assert.equal(onetCredentials(), null);
  });

  it("reports configured when username and password set", () => {
    process.env.ONET_USERNAME = "demo";
    process.env.ONET_PASSWORD = "secret";
    assert.equal(isOnetConfigured(), true);
    assert.deepEqual(onetCredentials(), { username: "demo", password: "secret" });
  });

  it("reports configured when username and API key set", () => {
    process.env.ONET_USERNAME = "demo";
    process.env.ONET_API_KEY = "my-api-key";
    assert.equal(isOnetConfigured(), true);
    assert.deepEqual(onetCredentials(), {
      username: "demo",
      password: "my-api-key",
      apiKey: "my-api-key",
    });
  });

  it("reports configured when only API key set", () => {
    process.env.ONET_API_KEY = "my-api-key";
    assert.equal(isOnetConfigured(), true);
    assert.deepEqual(onetCredentials(), {
      username: "my-api-key",
      password: "my-api-key",
      apiKey: "my-api-key",
    });
  });
});

