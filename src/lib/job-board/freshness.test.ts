import assert from "node:assert/strict";
import test from "node:test";
import { resolveExpiry, isFresh, MAX_JOB_AGE_DAYS } from "./freshness";

const DAY = 24 * 60 * 60 * 1000;

test("resolveExpiry uses postedAt + ttl when posted date is known", () => {
  const posted = new Date("2026-06-01T00:00:00Z");
  const scraped = new Date("2026-06-20T00:00:00Z");
  const expiry = resolveExpiry(posted, scraped, 30);
  assert.equal(expiry.getTime(), posted.getTime() + 30 * DAY);
});

test("resolveExpiry falls back to scrapedAt + ttl when postedAt is null", () => {
  const scraped = new Date("2026-06-20T00:00:00Z");
  const expiry = resolveExpiry(null, scraped, 30);
  assert.equal(expiry.getTime(), scraped.getTime() + 30 * DAY);
});

test("resolveExpiry default ttl is MAX_JOB_AGE_DAYS", () => {
  const scraped = new Date("2026-06-20T00:00:00Z");
  const expiry = resolveExpiry(null, scraped);
  assert.equal(expiry.getTime(), scraped.getTime() + MAX_JOB_AGE_DAYS * DAY);
});

test("isFresh keeps unknown postedAt (null) and recent jobs, drops old ones", () => {
  const now = new Date("2026-06-25T00:00:00Z");
  assert.equal(isFresh(null, now), true);
  assert.equal(isFresh(new Date("2026-06-20T00:00:00Z"), now, 45), true);
  assert.equal(isFresh(new Date("2026-04-01T00:00:00Z"), now, 45), false);
});
