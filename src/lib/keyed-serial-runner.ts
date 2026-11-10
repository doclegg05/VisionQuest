import { AsyncLocalStorage } from "node:async_hooks";

/**
 * One running task per key, with at most one queued behind it.
 *
 * Built for the deferred alert sync (`deferPerStudent` in after-response.ts):
 * a student who taps Submit fourteen times must not start fourteen syncs of
 * the same alert rows at once (prod, 2026-09-07). Every call still gets a
 * sync that starts after its write: the queued run begins only once the
 * running one settles, so it reads every write committed before then. Calls
 * that arrive while a run is already queued share that queued run.
 *
 * A failure in the running task rejects its own caller's promise and never
 * cancels the queued one. The queued task keeps the async context (and with
 * it the RLS actor) of the call that queued it, not that of the run it waits
 * behind: it is bound with `AsyncLocalStorage.bind` when queued.
 *
 * Process-local. Two server processes can each run one sync for the same
 * student; this only stops one process piling up its own.
 */
export interface KeyedSerialRunner {
  run(key: string, task: () => Promise<void>): Promise<void>;
}

interface Slot {
  readonly current: Promise<void>;
  readonly queued: Promise<void> | null;
}

async function invoke(task: () => Promise<void>): Promise<void> {
  await task();
}

const ignore = (): void => undefined;

export function createKeyedSerialRunner(): KeyedSerialRunner {
  const slots = new Map<string, Slot>();

  function launch(key: string, task: () => Promise<void>): Promise<void> {
    const current: Promise<void> = invoke(task).finally(() => {
      const slot = slots.get(key);
      // A queued run takes the slot over in its own launch; leaving the slot
      // in place until then keeps later callers joining that queued run.
      if (slot?.current === current && slot.queued === null) slots.delete(key);
    });
    slots.set(key, { current, queued: null });
    return current;
  }

  function run(key: string, task: () => Promise<void>): Promise<void> {
    const bound = AsyncLocalStorage.bind(task);
    const slot = slots.get(key);
    if (!slot) return launch(key, bound);
    if (slot.queued) return slot.queued;
    const queued = slot.current.then(ignore, ignore).then(() => launch(key, bound));
    slots.set(key, { current: slot.current, queued });
    return queued;
  }

  return { run };
}
