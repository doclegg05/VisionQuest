import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import { renderToString } from "react-dom/server";
import type { InterventionQueueEntry, QueueAlert } from "@/lib/teacher/intervention-queue";
import type { QueueReloadHooks } from "./queue-undo";

/**
 * The panel's own wiring, which the pure tests beside it cannot see: that its queue load reports to the Undo flow
 * through runQueueLoad, and that its heading counts with the flow's done lines.
 *
 * react-dom/server runs no effects and no clicks. So the Undo hook is swapped for a stand-in that hands back the
 * load function the panel gave it, and the test calls that function with its own reload hooks.
 */

type Load = (reload: QueueReloadHooks) => Promise<unknown>;

interface PendingGet {
  url: string;
  answer: (queue: InterventionQueueEntry[]) => void;
  failLoad: () => void;
}

const hook: { load: Load | null; done: Set<string> } = { load: null, done: new Set() };
const gets: PendingGet[] = [];

mock.module("next/navigation", { exports: { useSearchParams: () => new URLSearchParams() } });

mock.module("@/lib/api", {
  exports: {
    api: {
      get: (url: string) =>
        new Promise((resolve, reject) => {
          gets.push({
            url,
            answer: (queue) => resolve({ queue }),
            failLoad: () => reject(new Error("offline")),
          });
        }),
    },
    apiFetch: async () => {
      throw new Error("not used here");
    },
  },
});

mock.module("./useQueueUndo", {
  exports: {
    useQueueUndo: (options: { load: Load }) => {
      hook.load = options.load;
      return {
        act: () => true,
        undo: () => {},
        refresh: async () => null,
        refreshList: () => {},
        clear: () => {},
        lineState: () => ({ kind: "actions" }),
        isDone: (alertId: string) => hook.done.has(alertId),
        hasDone: hook.done.size > 0,
        failure: null,
        status: null,
      };
    },
  },
});

function alert(id: string, severity: string): QueueAlert {
  return {
    id,
    type: "overdue_task",
    severity,
    title: "Overdue task",
    summary: "A task is overdue.",
    sourceType: null,
    sourceId: null,
    detectedAt: "2026-10-05T12:00:00.000Z",
  };
}

function entry(studentId: string, name: string, openAlerts: QueueAlert[]): InterventionQueueEntry {
  return {
    studentId,
    publicStudentId: studentId.toUpperCase(),
    name,
    email: null,
    programType: "spokes",
    urgencyScore: 30,
    urgencyReasons: ["1 open alert"],
    primaryAlert: openAlerts[0] ?? null,
    openAlerts,
    recommendedAction: { kind: "create_task", label: "Add task", href: `/teacher/students/${studentId}` },
    signals: {
      daysSinceLastGoalReview: null,
      daysSinceLastLogin: 2,
      orientationComplete: true,
      orientationProgress: 1,
      openAlertCount: openAlerts.length,
      highSeverityAlertCount: 1,
      overdueTaskCount: 1,
      stalledGoalCount: 0,
      unmatchedGoalCount: 0,
      evidenceGapCount: 0,
      readinessScore: 50,
    },
  };
}

const QUEUE = [entry("stu-1", "Sam Rivera", [alert("c1", "critical")]), entry("stu-2", "Ana Lopez", [alert("h1", "high")])];

let InterventionQueuePanel: typeof import("./InterventionQueuePanel").default;

before(async () => {
  ({ default: InterventionQueuePanel } = await import("./InterventionQueuePanel"));
});

beforeEach(() => {
  hook.load = null;
  hook.done = new Set();
  gets.length = 0;
});

function render(): string {
  return renderToString(<InterventionQueuePanel initialQueue={QUEUE} />);
}

function text(html: string): string {
  return html.replace(/<!-- -->/g, "").replace(/<[^>]*>/g, " ");
}

/** Reload hooks that write down every call, as the flow would get them. */
function recorder(token: number): { reload: QueueReloadHooks; calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    reload: {
      beginReload: () => {
        calls.push("beginReload");
        return token;
      },
      reloaded: (landed) => {
        calls.push(`reloaded(${String(landed)})`);
      },
    },
  };
}

function panelLoad(): Load {
  render();
  assert.ok(hook.load, "the panel gave the Undo hook no load function");
  return hook.load;
}

describe("InterventionQueuePanel heading", () => {
  it("counts urgent students from the queue", () => {
    assert.match(text(render()), /2 students need follow-up · 2 urgent/);
  });

  it("leaves out an urgent alert the Undo flow shows as done, not the raw count", () => {
    hook.done = new Set(["h1"]);
    assert.match(text(render()), /2 students need follow-up · 1 urgent/);
  });

  it("offers Refresh list only while the Undo flow has a done line", () => {
    assert.doesNotMatch(render(), />Refresh list<\/button>/);
    hook.done = new Set(["h1"]);
    assert.match(render(), />Refresh list<\/button>/);
  });
});

describe("InterventionQueuePanel queue load", () => {
  it("takes the flow's token before its request leaves, and reports it once the rows land", async () => {
    const load = panelLoad();
    const { reload, calls } = recorder(4);
    const pending = load(reload);
    assert.deepEqual(calls, ["beginReload"]);
    assert.equal(gets.length, 1);
    assert.equal(gets[0].url, "/api/teacher/intervention-queue");
    gets[0].answer(QUEUE);
    assert.deepEqual(await pending, QUEUE);
    assert.deepEqual(calls, ["beginReload", "reloaded(4)"]);
  });

  it("a load that a newer one replaced reports nothing to the flow", async () => {
    const load = panelLoad();
    const older = recorder(1);
    const newer = recorder(2);
    const first = load(older.reload);
    const second = load(newer.reload);
    gets[0].answer(QUEUE);
    await first;
    assert.deepEqual(older.calls, ["beginReload"], "the replaced load must not clear any done line");
    gets[1].answer(QUEUE);
    await second;
    assert.deepEqual(newer.calls, ["beginReload", "reloaded(2)"]);
  });

  it("a failed load reports nothing to the flow", async () => {
    const load = panelLoad();
    const { reload, calls } = recorder(3);
    const pending = load(reload);
    gets[0].failLoad();
    assert.equal(await pending, null);
    assert.deepEqual(calls, ["beginReload"]);
  });
});
