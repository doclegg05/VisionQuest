/**
 * A stand-in for the parts of `@sentry/nextjs` the server reporting paths
 * call, for tests only. It reproduces the one SDK behavior those paths rely
 * on: an event processor added to a `withScope` scope runs after the SDK has
 * attached the request and the breadcrumb trail, and `beforeSend` (scrubPii)
 * runs last. The "SDK-attached" fields below are deliberately full of student
 * data, so a test that finds none of it in the sent event proves the
 * processor removed it rather than that it was never there.
 */
import type { ErrorEvent, Event } from "@sentry/nextjs";
import { scrubPii } from "./sentry-scrub";

type Processor = (event: Event) => Event | null;

export const STUDENT_NAME = "Tanesha Rivers";
export const STUDENT_EMAIL = "tanesha.rivers@example.org";
export const STUDENT_CUID = "cm3x9k2qp0000ab12cd34ef56";

/** What the SDK itself would attach to an event raised inside a request. */
function sdkAttached(): Pick<Event, "request" | "breadcrumbs" | "user"> {
  return {
    request: {
      url: `https://vq.example/api/teacher/students/${STUDENT_CUID}?q=${encodeURIComponent(STUDENT_NAME)}`,
      method: "POST",
      query_string: `q=${STUDENT_NAME}`,
      data: { displayName: STUDENT_NAME, email: STUDENT_EMAIL },
      headers: { referer: `https://vq.example/teacher/students/${STUDENT_CUID}` },
    },
    breadcrumbs: [{ category: "console", message: `looked up ${STUDENT_EMAIL}` }],
    user: { id: STUDENT_CUID, email: STUDENT_EMAIL },
  };
}

interface FakeScope {
  processors: Processor[];
  addEventProcessor(processor: Processor): FakeScope;
  setTag(key: string, value: string): FakeScope;
  setExtras(extras: Record<string, unknown>): FakeScope;
}

function newScope(): FakeScope {
  const scope: FakeScope = {
    processors: [],
    addEventProcessor(processor) {
      scope.processors.push(processor);
      return scope;
    },
    setTag(key, value) {
      scope.processors.push((event) => ({ ...event, tags: { ...event.tags, [key]: value } }));
      return scope;
    },
    setExtras(extras) {
      scope.processors.push((event) => ({ ...event, extra: { ...event.extra, ...extras } }));
      return scope;
    },
  };
  return scope;
}

export interface SentryDouble {
  sent: Event[];
  scopes: FakeScope[];
  reset(): void;
  exports: Record<string, unknown>;
}

export function createSentryDouble(): SentryDouble {
  const double: SentryDouble = { sent: [], scopes: [], reset() {}, exports: {} };
  const stack: FakeScope[] = [];

  function send(base: ErrorEvent): void {
    const processors = stack.flatMap((scope) => scope.processors);
    let event: Event | null = { ...base, ...sdkAttached() };
    for (const processor of processors) {
      if (event === null) return;
      event = processor(event);
    }
    if (event !== null) double.sent.push(scrubPii(event));
  }

  function errorEvent(error: unknown): ErrorEvent {
    const type = error instanceof Error ? error.name : "Error";
    const value = error instanceof Error ? error.message : String(error);
    return { type: undefined, exception: { values: [{ type, value }] } };
  }

  double.reset = () => {
    double.sent.length = 0;
    double.scopes.length = 0;
  };
  double.exports = {
    withScope<T>(callback: (scope: FakeScope) => T): T {
      const scope = newScope();
      double.scopes.push(scope);
      stack.push(scope);
      try {
        return callback(scope);
      } finally {
        stack.pop();
      }
    },
    captureException(error: unknown): string {
      send(errorEvent(error));
      return "event-id";
    },
    captureMessage(message: string, level?: string): string {
      send({ type: undefined, message, level: level as ErrorEvent["level"] });
      return "event-id";
    },
    captureRequestError(error: unknown, request: { path: string; method: string }): void {
      // The real one adds a `nextjs` context with the path it was given.
      stack.push({ ...newScope(), processors: [(event) => ({ ...event, contexts: { nextjs: { request_path: request.path } } })] });
      try {
        send(errorEvent(error));
      } finally {
        stack.pop();
      }
    },
    flush: async (): Promise<boolean> => true,
  };
  return double;
}
