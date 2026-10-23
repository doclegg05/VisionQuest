import assert from "node:assert/strict";
import { before, it, mock } from "node:test";
const create = mock.fn(async (input: { data: Record<string, unknown> }) => input.data);
mock.module("@/lib/db", { namedExports: { prisma: { message: { create } } } });
let saveMessage: typeof import("./conversation").saveMessage;
before(async () => { ({ saveMessage } = await import("./conversation")); });
it("commits a memory intent atomically with a Mac-served assistant message", async () => {
  process.env.VQ_MAC_RELAY_ENABLED = "true";
  try {
    await saveMessage("conv", "owner", "assistant", "Synthetic reply");
    assert.deepEqual(create.mock.calls.at(-1)?.arguments[0].data, {
      conversationId: "conv", studentId: "owner", role: "assistant", content: "Synthetic reply", metadata: '{"memoryJob":true}',
    });
    await saveMessage("conv", "owner", "user", "Synthetic question");
    assert.equal(create.mock.calls.at(-1)?.arguments[0].data.metadata, undefined);
    process.env.SAGE_MEMORY_ENABLED = "false";
    await saveMessage("conv", "owner", "assistant", "Synthetic reply");
    assert.equal(create.mock.calls.at(-1)?.arguments[0].data.metadata, undefined);
  } finally { delete process.env.VQ_MAC_RELAY_ENABLED; delete process.env.SAGE_MEMORY_ENABLED; }
});
