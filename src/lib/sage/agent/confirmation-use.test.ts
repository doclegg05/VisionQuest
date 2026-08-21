/* eslint-disable @typescript-eslint/no-explicit-any -- mock.fn() scaffolding is assigned to many different real function signatures; a shared "accept any implementation" escape hatch is intentional for test setup only. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { before, beforeEach, describe, it, mock } from "node:test";

// ---------------------------------------------------------------------------
// Unit tests for claimConfirmationToken — the single-use claim behind
// /api/chat/tool-confirm. The DB is faked at the @/lib/db seam; the atomicity
// contract (INSERT on the primary key, P2002 = someone else claimed first)
// is what these tests pin.
// ---------------------------------------------------------------------------

const mockCreate = mock.fn() as any;
const mockDeleteMany = mock.fn() as any;
const mockWarn = mock.fn() as any;

mock.module("@/lib/db", {
  namedExports: {
    prisma: {},
    prismaAdmin: {
      sageConfirmationUse: {
        create: mockCreate,
        deleteMany: mockDeleteMany,
      },
    },
  },
});

mock.module("@/lib/logger", {
  namedExports: {
    logger: { error: mock.fn(), warn: mockWarn, info: mock.fn() },
  },
});

let claimConfirmationToken: (token: string, clock: Date) => Promise<"claimed" | "replayed">;

before(async () => {
  ({ claimConfirmationToken } = await import("./confirmation-use"));
});

const CLOCK = new Date("2026-08-21T12:00:00.000Z");
const EXPIRES_MS = CLOCK.getTime() + 5 * 60 * 1000;
const TOKEN = `${EXPIRES_MS}.abc123signature`;

function p2002(): Error & { code: string } {
  const err = new Error("Unique constraint failed on the fields: (`tokenHash`)") as Error & {
    code: string;
  };
  err.code = "P2002";
  return err;
}

/** The fire-and-forget sweep settles a microtask after claim resolves. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

describe("claimConfirmationToken", () => {
  beforeEach(() => {
    mockCreate.mock.resetCalls();
    mockDeleteMany.mock.resetCalls();
    mockWarn.mock.resetCalls();
    mockCreate.mock.mockImplementation(async ({ data }: any) => ({ ...data }));
    mockDeleteMany.mock.mockImplementation(async () => ({ count: 0 }));
  });

  it("claims a fresh token, storing only its hash with the token's own expiry", async () => {
    const outcome = await claimConfirmationToken(TOKEN, CLOCK);
    assert.equal(outcome, "claimed");

    assert.equal(mockCreate.mock.callCount(), 1);
    const { data } = mockCreate.mock.calls[0].arguments[0];
    assert.equal(data.tokenHash, createHash("sha256").update(TOKEN).digest("hex"));
    assert.match(data.tokenHash, /^[0-9a-f]{64}$/);
    assert.notEqual(data.tokenHash, TOKEN);
    assert.equal(data.expiresAt.getTime(), EXPIRES_MS);
  });

  it("reports a unique-constraint loss as a replay", async () => {
    mockCreate.mock.mockImplementation(async () => {
      throw p2002();
    });
    const outcome = await claimConfirmationToken(TOKEN, CLOCK);
    assert.equal(outcome, "replayed");
  });

  it("propagates non-P2002 store failures (fail closed)", async () => {
    mockCreate.mock.mockImplementation(async () => {
      const err = new Error("write conflict or deadlock") as Error & { code: string };
      err.code = "P2034";
      throw err;
    });
    await assert.rejects(() => claimConfirmationToken(TOKEN, CLOCK), /write conflict/);
  });

  it("sweeps expired rows after a successful claim, without blocking on it", async () => {
    await claimConfirmationToken(TOKEN, CLOCK);
    await settle();

    assert.equal(mockDeleteMany.mock.callCount(), 1);
    const { where } = mockDeleteMany.mock.calls[0].arguments[0];
    assert.equal(where.expiresAt.lt.getTime(), CLOCK.getTime());
  });

  it("does not sweep on a replay", async () => {
    mockCreate.mock.mockImplementation(async () => {
      throw p2002();
    });
    await claimConfirmationToken(TOKEN, CLOCK);
    await settle();
    assert.equal(mockDeleteMany.mock.callCount(), 0);
  });

  it("a failing sweep is logged, never surfaced to the confirm flow", async () => {
    mockDeleteMany.mock.mockImplementation(async () => {
      throw new Error("sweep blew up");
    });
    const outcome = await claimConfirmationToken(TOKEN, CLOCK);
    assert.equal(outcome, "claimed");
    await settle();
    assert.equal(mockWarn.mock.callCount(), 1);
  });

  it("falls back to clock + TTL for a token with no parseable expiry", async () => {
    // Defensive only — the route claims tokens AFTER verification, and an
    // unparseable prefix cannot verify. The fallback keeps the row's sweep
    // horizon sane rather than storing an Invalid Date.
    const outcome = await claimConfirmationToken("not-a-real-token", CLOCK);
    assert.equal(outcome, "claimed");
    const { data } = mockCreate.mock.calls[0].arguments[0];
    assert.equal(data.expiresAt.getTime(), CLOCK.getTime() + 10 * 60 * 1000);
  });
});
