/**
 * Shared by the queue-undo test files: three alerts, a harness that records what the flow sends and asks, and
 * helpers that hold a request open so a test can act while it is out.
 */
import {
  alertLineState,
  createQueueUndo,
  type QueueSendRequest,
  type QueueUndo,
  type QueueUndoDeps,
  type QueueUndoTarget,
} from "./queue-undo";

export const LOW: QueueUndoTarget = { id: "a1", severity: "medium", title: "Goal review", studentName: "Sam Rivera" };
export const LOW2: QueueUndoTarget = { id: "a2", severity: "low", title: "Missing form", studentName: "Ana Lopez" };
export const CRITICAL: QueueUndoTarget = {
  id: "w1",
  severity: "critical",
  title: "Wellbeing check",
  studentName: "Jo Park",
};

export interface Harness {
  deps: QueueUndoDeps;
  sent: Array<[string, QueueSendRequest]>;
  confirms: Array<{ title: string; message: string }>;
  refreshes: () => number;
  /** Fail the next send of this request once, then let it succeed. */
  failOnce: (request: QueueSendRequest) => void;
}

export interface HarnessOptions {
  failOn?: QueueSendRequest;
  confirmAnswer?: boolean;
  refreshResult?: boolean | "reject";
}

export function harness(options: HarnessOptions = {}): Harness {
  const sent: Harness["sent"] = [];
  const confirms: Harness["confirms"] = [];
  const failNext = new Set<QueueSendRequest>();
  let refreshCount = 0;
  const deps: QueueUndoDeps = {
    send: async (alertId, request) => {
      sent.push([alertId, request]);
      if (options.failOn === request || failNext.delete(request)) throw new Error("network down");
    },
    confirm: async (question) => {
      confirms.push({ title: question.title, message: question.message });
      return options.confirmAnswer ?? true;
    },
    // Plays the panel's loader: a token before the request, and a report only when the load worked.
    refresh: async (reload) => {
      const token = reload.beginReload();
      refreshCount += 1;
      if (options.refreshResult === "reject") throw new Error("offline");
      const loaded = options.refreshResult ?? true;
      if (loaded) reload.reloaded(token);
      return loaded;
    },
  };
  return {
    deps,
    sent,
    confirms,
    refreshes: () => refreshCount,
    failOnce: (request) => {
      failNext.add(request);
    },
  };
}

export function offered(flow: QueueUndo, alertId: string): boolean {
  const line = alertLineState(flow.current(), alertId);
  return line.kind === "done" && line.undoable;
}

/** The done lines by alert id, without their sequence numbers. */
export function doneActions(flow: QueueUndo): Record<string, string> {
  return Object.fromEntries(Object.entries(flow.current().done).map(([id, entry]) => [id, entry.action]));
}

/** A load that began now and has put its rows on screen. */
export function landReload(flow: QueueUndo): void {
  flow.reloaded(flow.beginReload());
}

/** Lets every promise that has already settled run what waits on it. */
export const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

export interface Held {
  deps: QueueUndoDeps;
  release: () => void;
  fail: () => void;
}

/** Holds every send of one request open until the test releases or fails it. Other requests answer at once. */
export function holding(h: Harness, request: QueueSendRequest): Held {
  let release: () => void = () => {};
  let fail: () => void = () => {};
  const send: QueueUndoDeps["send"] = (alertId, sent) => {
    if (sent !== request) return h.deps.send(alertId, sent);
    h.sent.push([alertId, sent]);
    return new Promise<void>((resolve, reject) => {
      release = resolve;
      fail = () => reject(new Error("network down"));
    });
  };
  return { deps: { ...h.deps, send }, release: () => release(), fail: () => fail() };
}

/** A flow whose confirm stays open until the test answers it. */
export function withOpenConfirm(h: Harness): { flow: QueueUndo; answer: (yes: boolean) => void } {
  let answer: (yes: boolean) => void = () => {};
  const flow = createQueueUndo({
    ...h.deps,
    confirm: () =>
      new Promise<boolean>((resolve) => {
        answer = resolve;
      }),
  });
  return { flow, answer: (yes) => answer(yes) };
}
