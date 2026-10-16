import assert from "node:assert/strict";
import { afterEach, before, beforeEach, describe, it, mock } from "node:test";
import * as React from "react";
import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";

/**
 * Upload failures belong next to the Choose File button, not in a dialog and
 * not in place of the page. FileManager once handled them three different
 * wrong ways: a too-large file replaced the whole file list with the
 * page-level error screen, a server refusal opened a modal dialog, and a
 * network failure was only logged, so the student saw nothing at all.
 *
 * react-dom/server cannot run effects or change handlers, so this file swaps
 * React's hooks for a small state table: call the component as a function,
 * run its mount effect, fire the file input's onChange, call it again, then
 * server-render what comes back.
 */

const slots: unknown[] = [];
let cursor = 0;
const effects: Array<() => void> = [];
const dialogs: unknown[] = [];

const realReact = Object.fromEntries(Object.entries(React).filter(([key]) => key !== "default"));

mock.module("react", {
  exports: {
    ...realReact,
    useState(initial: unknown) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = initial;
      return [slots[index], (next: unknown) => { slots[index] = next; }];
    },
    useRef(initial: unknown) {
      return { current: initial };
    },
    useEffect(effect: () => void) {
      effects.push(effect);
    },
    useId() {
      return "category";
    },
  },
});

mock.module("@/components/ui/useConfirm", {
  exports: {
    useConfirm: () => ({
      confirm: async () => true,
      alert: async (options: unknown) => {
        dialogs.push(options);
      },
      prompt: async () => null,
      confirmDialog: null,
    }),
  },
});

mock.module("@/components/sage/AskSageLink", { exports: { default: () => null } });

type FakeFile = { name: string; size: number; type: string };
type FileChange = (event: { target: { files: FakeFile[] } }) => Promise<void>;
type InputProps = { type?: unknown; onChange?: FileChange; children?: ReactNode };
type FakeResponse = { ok: boolean; json: () => Promise<unknown> };
type FetchStep = () => Promise<FakeResponse>;

const STORED_FILE = {
  id: "file-1",
  filename: "resume.pdf",
  mimeType: "application/pdf",
  sizeBytes: 2048,
  category: "resume",
  uploadedAt: "2026-10-01T12:00:00.000Z",
};
const SMALL: FakeFile = { name: "notes.pdf", size: 2048, type: "application/pdf" };
const TOO_LARGE: FakeFile = { name: "scan.pdf", size: 12 * 1024 * 1024, type: "application/pdf" };

const listLoads: FetchStep = async () => ({ ok: true, json: async () => ({ files: [STORED_FILE] }) });
const networkDown: FetchStep = async () => {
  throw new TypeError("fetch failed");
};

let FileManager: typeof import("./FileManager").default;

before(async () => {
  ({ default: FileManager } = await import("./FileManager"));
});

beforeEach(() => {
  slots.length = 0;
  effects.length = 0;
  dialogs.length = 0;
});

afterEach(() => {
  mock.restoreAll();
});

function stubFetch(list: FetchStep, upload: FetchStep): void {
  mock.method(globalThis, "fetch", async (_url: unknown, init?: { method?: string }) =>
    init?.method === "POST" ? upload() : list(),
  );
}

function render() {
  cursor = 0;
  return FileManager();
}

async function settle(): Promise<void> {
  for (let tick = 0; tick < 5; tick++) await new Promise((resolve) => setImmediate(resolve));
}

async function mount(): Promise<void> {
  render();
  for (const effect of effects.splice(0)) effect();
  await settle();
}

function findFileChange(node: ReactNode): FileChange | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findFileChange(child);
      if (found) return found;
    }
    return undefined;
  }
  if (!React.isValidElement<InputProps>(node)) return undefined;
  if (node.type === "input" && node.props.type === "file") return node.props.onChange;
  return findFileChange(node.props.children);
}

async function pickFile(file: FakeFile): Promise<string> {
  const onChange = findFileChange(render());
  assert.ok(onChange, "the upload section renders a file input");
  await onChange({ target: { files: [file] } });
  await settle();
  return renderToString(render());
}

function alertIn(html: string): { tag: string; text: string } {
  const match = /<p\b[^>]*role="alert"[^>]*>([^<]*)<\/p>/.exec(html);
  assert.ok(match, `no role="alert" message in: ${html}`);
  return { tag: match[0], text: match[1] };
}

describe("FileManager upload errors", () => {
  it("a file over 10 MB shows an inline alert and keeps the file list on screen", async () => {
    stubFetch(listLoads, async () => assert.fail("a too-large file must not be sent"));
    await mount();
    const html = await pickFile(TOO_LARGE);

    const { tag, text } = alertIn(html);
    assert.equal(text, "File is too large. Maximum size is 10MB.");
    assert.match(tag, /text-\[var\(--badge-error-text\)\]/, "error text uses the theme-aware error token");
    assert.ok(html.includes(STORED_FILE.filename), "the student's files stay listed");
    assert.ok(!html.includes("Try Again"), "an upload error is not a page-load failure");
  });

  it("a server refusal shows the server's message inline, with no dialog", async () => {
    stubFetch(listLoads, async () => ({
      ok: false,
      json: async () => ({ error: "That file type is not allowed." }),
    }));
    await mount();
    const html = await pickFile(SMALL);

    assert.equal(alertIn(html).text, "That file type is not allowed.");
    assert.deepEqual(dialogs, [], "no modal dialog for an upload failure");
  });

  it("a network failure shows an inline alert instead of only logging", async () => {
    stubFetch(listLoads, networkDown);
    mock.method(console, "error", () => {});
    await mount();
    const html = await pickFile(SMALL);

    assert.equal(alertIn(html).text, "Upload failed. Please try again.");
  });
});

describe("FileManager load error", () => {
  it("announces a failed file-list load with the theme-aware error token", async () => {
    stubFetch(networkDown, networkDown);
    mock.method(console, "error", () => {});
    await mount();
    const html = renderToString(render());

    const { tag, text } = alertIn(html);
    assert.equal(text, "Failed to load. Please try again.");
    assert.match(tag, /text-\[var\(--badge-error-text\)\]/, "error text uses the theme-aware error token");
  });
});
