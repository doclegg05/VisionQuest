import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Breadcrumb, ErrorEvent, Event } from "@sentry/nextjs";
import { routePattern, scrubPii, withheldServerEvent } from "./sentry-scrub";
import {
  browserErrorEvent,
  chainedExceptionEvent,
  PLANTED,
  plantedIn,
  sdkBreadcrumbs,
  serverSelfCapturedEvent,
  thrownObjectEvent,
  transactionEvent,
} from "./sentry.test-support";

// H1 privacy follow-up (2026-11-10). A privacy audit fed SDK-shaped events
// through the first scrub and found student data still leaving. One test per
// leak, numbered as the audit numbered them. Each fixture is built the way the
// installed SDK builds it (src/lib/sentry.test-support.ts cites the files) and
// carries planted student data; `plantedIn` lists whatever of it is left.

/** The event as `beforeSend` would return it. */
function sent(event: Event): ErrorEvent | null {
  return scrubPii(event, {});
}

function withBreadcrumb(breadcrumb: Breadcrumb): ErrorEvent {
  return { ...browserErrorEvent(), breadcrumbs: [breadcrumb] };
}

describe("1. breadcrumbs", () => {
  for (const kind of ["click", "navigation", "fetch", "console"] as const) {
    it(`a ${kind} breadcrumb does not leave`, () => {
      const out = sent(withBreadcrumb(sdkBreadcrumbs[kind]()));
      assert.deepEqual(plantedIn(out), []);
      assert.equal(out?.breadcrumbs, undefined);
    });
  }
});

describe("2. URLs", () => {
  it("a browser event keeps no page URL, query string, referrer or user agent", () => {
    const out = sent(browserErrorEvent());
    assert.deepEqual(plantedIn(out), []);
    assert.equal(out?.request, undefined);
    assert.equal(out?.tags?.route, "/credentials/[param]");
  });

  it("an inline-script stack frame, whose file name is the page URL, becomes a route pattern", () => {
    const out = sent(chainedExceptionEvent());
    const frames = out?.exception?.values?.flatMap((entry) => entry.stacktrace?.frames ?? []);
    assert.deepEqual(
      frames?.map((frame) => frame.filename),
      ["app:///_next/static/chunks/app/layout-0a1b2c3d.js", "/credentials/[param]"],
    );
  });
});

describe("3. server request data", () => {
  it("an event the SDK captured by itself carries no body, cookie, header, query string or address", () => {
    const out = sent(serverSelfCapturedEvent());
    assert.deepEqual(plantedIn(out), []);
    assert.equal(out?.request, undefined);
    assert.equal(out?.user, undefined);
    assert.equal(out?.breadcrumbs, undefined);
    assert.equal(out?.server_name, undefined);
    assert.equal(out?.modules, undefined);
    assert.deepEqual(out?.tags, { route: "/api/teacher/students/[param]/notes", method: "POST" });
  });

  it("a transaction is not sent at all", () => {
    assert.equal(sent(transactionEvent()), null);
  });
});

describe("4. a thrown plain object", () => {
  it("is not sent as extra.__serialized__, and its key list is withheld", () => {
    const out = sent(thrownObjectEvent());
    assert.deepEqual(plantedIn(out), []);
    assert.equal(out?.extra, undefined);
    assert.equal(out?.exception?.values?.[0]?.value, "[message withheld]");
  });

  it("the server-path processor drops it too, before the scrub runs", () => {
    const out = withheldServerEvent({ route: "/api/x" })(thrownObjectEvent());
    assert.deepEqual(out.extra, {});
  });
});

describe("5. exception messages", () => {
  it("every exception in a chain keeps its type and loses its message", () => {
    const out = sent(chainedExceptionEvent());
    assert.deepEqual(plantedIn(out), []);
    assert.deepEqual(
      out?.exception?.values?.map((entry) => [entry.type, entry.value]),
      [
        ["SyntaxError", "[message withheld]"],
        ["Error", "[message withheld]"],
      ],
    );
  });

  it("an error name that is not a class name is not sent", () => {
    const event = browserErrorEvent();
    const out = sent({ ...event, exception: { values: [{ type: `no student ${PLANTED.name}`, value: "x" }] } });
    assert.equal(out?.exception?.values?.[0]?.type, "Error");
  });

  it("keeps the chain's structure, so the report still says which error caused which", () => {
    const out = sent(chainedExceptionEvent());
    assert.deepEqual(out?.exception?.values?.[0]?.mechanism, {
      type: "chained",
      handled: true,
      source: "cause",
      exception_id: 1,
      parent_id: 0,
    });
  });

  it("a message event keeps its text only when the alarm hook named it", () => {
    const alarm: ErrorEvent = { type: undefined, message: "wellbeing_no_recipients", tags: { alert: "wellbeing_no_recipients" } };
    assert.equal(sent(alarm)?.message, "wellbeing_no_recipients");

    const freeText: ErrorEvent = { type: undefined, message: `sync failed for ${PLANTED.name}` };
    assert.equal(sent(freeText)?.message, "[message withheld]");

    const cron: ErrorEvent = { type: undefined, message: 'pg_cron job "alert-sync" failed', tags: { jobname: "alert-sync", status: "failed" } };
    const out = sent(cron);
    assert.equal(out?.message, "[message withheld] job alert-sync");
    assert.deepEqual(out?.tags, { jobname: "alert-sync", status: "failed" });
  });
});

describe("7. routePattern", () => {
  it("keeps a segment only when it is a real route directory", () => {
    assert.equal(routePattern(`/api/files/${PLANTED.slug}-resume.pdf`), "/api/files/[param]");
    assert.equal(routePattern(`/api/teacher/students/${PLANTED.loginId}`), "/api/teacher/students/[param]");
    assert.equal(routePattern(`/credentials/${PLANTED.slug}`), "/credentials/[param]");
    assert.equal(routePattern(`/api/teacher/students/${PLANTED.recordId}/goals`), "/api/teacher/students/[param]/goals");
  });

  it("drops the origin, the query string and the fragment", () => {
    assert.equal(routePattern(`https://vq.example/api/jobs?q=${PLANTED.search}#top`), "/api/jobs");
  });

  it("keeps a route pattern Next already wrote, and its own output", () => {
    assert.equal(routePattern("/teacher/students/[id]"), "/teacher/students/[id]");
    assert.equal(routePattern("/api/files/[param]"), "/api/files/[param]");
  });

  it("keeps every literal segment the API tree has, including the longest", () => {
    assert.equal(routePattern("/api/internal/evidence-gap-detection"), "/api/internal/evidence-gap-detection");
    assert.equal(routePattern("/api/teacher/reports/export.csv"), "/api/teacher/reports/export.csv");
  });

  it("replaces a numeric, mixed-case or unknown lowercase segment", () => {
    assert.equal(routePattern("/api/12345/Jane/zebra"), "/api/[param]/[param]/[param]");
  });
});

describe("8. record ids", () => {
  /** The one place free text can still reach the id pattern: a file path. */
  function fileNameOut(filename: string): string | undefined {
    const event: ErrorEvent = {
      type: undefined,
      exception: { values: [{ type: "Error", value: "x", stacktrace: { frames: [{ filename }] } }] },
    };
    return sent(event)?.exception?.values?.[0]?.stacktrace?.frames?.[0]?.filename;
  }

  it("redacts an id next to an underscore", () => {
    assert.equal(fileNameOut(`/srv/uploads/${PLANTED.recordId}_draft.js`), "/srv/uploads/[ID]_draft.js");
    assert.equal(fileNameOut(`/srv/uploads/draft_${PLANTED.recordId}.js`), "/srv/uploads/draft_[ID].js");
  });

  it("redacts an upper-case copy of an id", () => {
    assert.equal(fileNameOut(`/srv/uploads/${PLANTED.recordId.toUpperCase()}.js`), "/srv/uploads/[ID].js");
  });

  it("redacts a UUID and a cuid2", () => {
    assert.equal(fileNameOut("/srv/uploads/3f2b8c1e-9a4d-4e6f-8b2a-1c3d5e7f9a0b.js"), "/srv/uploads/[ID].js");
    assert.equal(fileNameOut("/srv/uploads/tz4a98xxat96iws9zmbrgj3a.js"), "/srv/uploads/[ID].js");
  });

  it("leaves a 32-character trace id alone", () => {
    const traceId = "c0123456789abcdef0123456789abcde";
    const event: ErrorEvent = { type: undefined, contexts: { trace: { trace_id: traceId, span_id: "a6f2a9809943c2b8" } } };
    assert.equal(sent(event)?.contexts?.trace?.trace_id, traceId);
  });
});

describe("11. extras", () => {
  it("carry numbers and booleans only, whoever set them", () => {
    const event: ErrorEvent = {
      type: undefined,
      message: "wellbeing_notify_failed",
      tags: { alert: "wellbeing_notify_failed" },
      extra: {
        attemptedCount: 3,
        degraded: true,
        student: PLANTED.loginId,
        error: { name: "Error", detail: PLANTED.name },
        ratio: Number.NaN,
        [`note for ${PLANTED.name}`]: 1,
      },
    };
    const out = sent(event);
    assert.deepEqual(out?.extra, { attemptedCount: 3, degraded: true });
    assert.deepEqual(plantedIn(out), []);
  });
});

describe("what a report still says", () => {
  it("an error event keeps its id, time, level, type, stack position and trace", () => {
    const out = sent(browserErrorEvent());
    assert.equal(out?.event_id, "cf422e038c924d96b957b892a76f01c8");
    assert.equal(out?.timestamp, 1794341288.62);
    assert.equal(out?.level, "error");
    assert.equal(out?.platform, "javascript");
    assert.equal(out?.environment, "production");
    assert.deepEqual(out?.exception?.values?.[0]?.stacktrace?.frames, [
      { filename: "app:///_next/static/chunks/app/layout-0a1b2c3d.js", function: "onClick", lineno: 12, colno: 7, in_app: true },
    ]);
    assert.deepEqual(out?.contexts, {
      trace: { trace_id: "56341d57f6794f93b8a549a6e413fed2", span_id: "a6f2a9809943c2b8" },
    });
  });

  it("keeps the source-map ids of its own script files, so a minified stack can be read", () => {
    // core/build/cjs/utils/prepareEvent.js `applyDebugMeta` moves each
    // frame's debug id here, keyed by the file the frame names.
    const event: ErrorEvent = {
      ...browserErrorEvent(),
      debug_meta: {
        images: [
          { type: "sourcemap", code_file: "https://vq.example/_next/static/chunks/app/layout-0a1b2c3d.js?v=1", debug_id: "3f2b8c1e-9a4d-4e6f-8b2a-1c3d5e7f9a0b" },
          { type: "sourcemap", code_file: `https://vq.example/credentials/${PLANTED.slug}`, debug_id: "3f2b8c1e-9a4d-4e6f-8b2a-1c3d5e7f9a0c" },
          { type: "sourcemap", code_file: "https://vq.example/_next/static/chunks/x.js", debug_id: `id for ${PLANTED.name}` },
        ],
      },
    };
    const out = sent(event);
    assert.deepEqual(out?.debug_meta, {
      images: [
        { type: "sourcemap", code_file: "app:///_next/static/chunks/app/layout-0a1b2c3d.js", debug_id: "3f2b8c1e-9a4d-4e6f-8b2a-1c3d5e7f9a0b" },
        { type: "sourcemap", code_file: "/credentials/[param]", debug_id: "3f2b8c1e-9a4d-4e6f-8b2a-1c3d5e7f9a0c" },
      ],
    });
    assert.deepEqual(plantedIn(out), []);
  });

  it("carries only fields on the allowlist, whatever the SDK adds later", () => {
    const event = { ...serverSelfCapturedEvent(), fingerprint: [PLANTED.name], logger: PLANTED.name, somethingNew: { note: PLANTED.chat } };
    const out = sent(event);
    assert.deepEqual(Object.keys(out ?? {}).sort(), [
      "contexts",
      "environment",
      "event_id",
      "exception",
      "extra",
      "level",
      "platform",
      "tags",
      "timestamp",
      "type",
    ]);
  });

  it("never throws, whatever it is given", () => {
    // Parsed, so the compiler cannot vouch for it: that is the point.
    const malformed: Event = JSON.parse(
      '{"exception":{"values":[{},{"type":7,"value":{},"stacktrace":{"frames":[{"filename":3}]},"mechanism":{}}]},"tags":{"route":7},"contexts":{"trace":{},"runtime":7},"request":{"url":9},"extra":[1],"sdk":{"packages":[{}]},"message":5}',
    );
    assert.doesNotThrow(() => scrubPii(malformed, {}));
    assert.deepEqual(plantedIn(scrubPii(malformed, {})), []);
  });
});
