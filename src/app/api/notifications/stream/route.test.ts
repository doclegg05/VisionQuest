import assert from "node:assert/strict";
import { before, mock, test } from "node:test";

let disconnect: () => void;
let finalized = 0;
let userId = "test-user";
let cursorWhere: unknown;
mock.module("@/lib/api-error", { namedExports: {
  withAuth: (handler: (session: { id: string }, req: Request) => Promise<Response>) =>
    (req: Request) => handler({ id: userId }, req),
} });
mock.module("@/lib/db", { namedExports: { prisma: { notification: {
  findUnique: async ({ where }: { where: unknown }) => { cursorWhere = where; return null; },
} } } });
mock.module("@/lib/notifications", { namedExports: {
  addConnection: (_id: string, writer: WritableStreamDefaultWriter<Uint8Array>, finalize: () => void) => {
    let closed = false;
    disconnect = () => {
      if (closed) return;
      closed = true;
      finalized++;
      void writer.abort().catch(() => {});
      finalize();
    };
    return disconnect;
  },
  writeConnection: async () => true,
} });
let GET: (req: Request) => Promise<Response>;
before(async () => { GET = (await import("./route")).GET as unknown as typeof GET; });

test("disconnect removes heartbeat and abort listener; already aborted requests clean up", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const abort = new AbortController();
  const req = new Request("https://app.example/api/notifications/stream", { signal: abort.signal });
  const remove = mock.method(req.signal, "removeEventListener");
  await GET(req);
  disconnect();
  assert.equal(remove.mock.callCount(), 1);
  assert.equal(finalized, 1);
  abort.abort();
  assert.equal(finalized, 1);
  await GET(new Request(req.url, { signal: abort.signal }));
  assert.equal(finalized, 2);
});
test("reconnect cursor belongs to authenticated user", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  await GET(new Request("https://app.example/api/notifications/stream?lastId=cursor"));
  assert.deepEqual(cursorWhere, { id: "cursor", studentId: userId });
  disconnect();
});
test("rate buckets expire and cannot grow past capacity", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval", "Date"], now: 1_000_000 });
  for (let i = 0; i < 5_000; i++) {
    userId = `user-${i}`;
    const response = await GET(new Request("https://app.example/api/notifications/stream"));
    // A prior test bucket may also occupy one slot.
    if (response.status === 200) disconnect();
  }
  userId = "overflow-user";
  assert.equal((await GET(new Request("https://app.example/api/notifications/stream"))).status, 503);
  t.mock.timers.tick(61_000);
  assert.equal((await GET(new Request("https://app.example/api/notifications/stream"))).status, 200);
  disconnect();
});
