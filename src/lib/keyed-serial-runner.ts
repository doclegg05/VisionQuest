import { AsyncLocalStorage } from "node:async_hooks";

/**
 * One running task per key, with at most one queued behind it, and an
 * optional cap on how many tasks run at once across all keys.
 *
 * Built for the deferred alert sync (`deferPerStudent` in after-response.ts):
 * a student who taps Submit fourteen times must not start fourteen syncs of
 * the same alert rows at once (prod, 2026-09-07). Every call still gets a
 * sync that starts after its write: the queued run begins only once the
 * running one settles, so it reads every write committed before then. Calls
 * that arrive while a run is already queued share that queued run.
 *
 * The cap (`maxConcurrent`) exists because one key at a time is not enough: a
 * class of 30 signing the same form is 30 keys, and 30 syncs against a pool
 * of 5 connections starve the requests those students are making. A task
 * takes its place under the cap only when its key's turn has come, and its
 * body starts after that, so the read-after-write promise above still holds.
 *
 * The deadline (`deadlineMs`) exists because of the cap: a run that never
 * settles would keep its key for good, and two of them would stop every run
 * in the process. Past the deadline the run is let go: its key and its place
 * are free again and `onDeadline` is told. The task itself cannot be
 * cancelled and may still be running; that is the lesser harm.
 *
 * A failure in the running task rejects its own caller's promise and never
 * cancels the queued one. A task runs in the async context (and with it the
 * RLS actor) of the call that passed it in: it is bound with
 * `AsyncLocalStorage.bind` on the way in, whatever later resolves the promise
 * it waits on. The tests cover the actor for a queued run and for a run that
 * waited for a place; they would also pass without the bind today, because
 * an async function resumes in its own context. The bind is kept so a
 * restructure cannot quietly change that.
 *
 * Process-local. Two server processes can each run one sync for the same
 * student; this only stops one process piling up its own.
 */
export interface KeyedSerialRunner {
  run(key: string, task: () => Promise<void>): Promise<void>;
}

export interface KeyedSerialRunnerOptions {
  /** Most tasks running at once across all keys. No cap when omitted. */
  readonly maxConcurrent?: number;
  /** How long one run may take before it is let go. No deadline when omitted. */
  readonly deadlineMs?: number;
  /** Told each time a run passes its deadline. It is given nothing that names the key. */
  readonly onDeadline?: () => void;
}

interface Slot {
  readonly current: Promise<void>;
  readonly queued: Promise<void> | null;
}

interface Places {
  /** Takes a place now if one is free. */
  tryTake(): boolean;
  /** Resolves when a place has been handed to this caller. */
  wait(): Promise<void>;
  giveBack(): void;
}

async function invoke(task: () => Promise<void>): Promise<void> {
  await task();
}

const ignore = (): void => undefined;

/** A first-come queue for the places under the cap. */
function createPlaces(limit: number | undefined): Places {
  if (limit === undefined) return { tryTake: () => true, wait: () => Promise.resolve(), giveBack: ignore };
  let taken = 0;
  const waiting: Array<() => void> = [];
  return {
    tryTake() {
      if (taken >= limit) return false;
      taken += 1;
      return true;
    },
    wait: () => new Promise<void>((resolve) => waiting.push(resolve)),
    giveBack() {
      const next = waiting.shift();
      // The place passes straight to the next in line, so `taken` is unchanged.
      if (next) next();
      else taken -= 1;
    },
  };
}

/** Settles when the task does, or at the deadline, whichever is first. */
function withDeadline(task: () => Promise<void>, options: KeyedSerialRunnerOptions): Promise<void> {
  const { deadlineMs, onDeadline } = options;
  if (deadlineMs === undefined) return invoke(task);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<void>((resolve) => {
    timer = setTimeout(() => {
      onDeadline?.();
      resolve();
    }, deadlineMs);
  });
  // The race holds a handler on the task's promise, so a task that fails
  // after its deadline is not an unhandled rejection.
  return Promise.race([invoke(task), deadline]).finally(() => clearTimeout(timer));
}

export function createKeyedSerialRunner(options: KeyedSerialRunnerOptions = {}): KeyedSerialRunner {
  const slots = new Map<string, Slot>();
  const places = createPlaces(options.maxConcurrent);

  /**
   * With a place free the task starts in this same tick, as it did before
   * there was a cap; only a task that has to wait starts later.
   */
  function runInPlace(task: () => Promise<void>): Promise<void> {
    const start = (): Promise<void> => withDeadline(task, options).finally(() => places.giveBack());
    return places.tryTake() ? start() : places.wait().then(start);
  }

  function launch(key: string, task: () => Promise<void>): Promise<void> {
    const current: Promise<void> = runInPlace(task).finally(() => {
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
