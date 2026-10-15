import assert from "node:assert/strict";
import { afterEach, before, beforeEach, describe, it, mock } from "node:test";
import * as React from "react";
import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";

/**
 * A failed upload has to say so in every state. The Re-upload buttons in the
 * pending and rejected states once set an error that only the no-submission
 * state rendered, so a student whose re-upload was too large or refused by
 * the server saw the button go quiet and nothing else.
 *
 * react-dom/server cannot run a change handler, so this file swaps React's
 * state hooks for a small table: call the component as a function, fire the
 * file input's onChange, call it again, then server-render what comes back.
 */

const slots: unknown[] = [];
let cursor = 0;

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
  },
});

type Status = "pending" | "approved" | "rejected" | null;
type FakeFile = { name: string; size: number; type: string };
type FileChange = (event: { target: { files: FakeFile[] } }) => Promise<void>;
type InputProps = { type?: unknown; onChange?: FileChange; children?: ReactNode };

let FormUploadButton: typeof import("./FormUploadButton").default;

before(async () => {
  ({ default: FormUploadButton } = await import("./FormUploadButton"));
});

beforeEach(() => {
  slots.length = 0;
});

afterEach(() => {
  mock.restoreAll();
});

function render(currentStatus: Status) {
  cursor = 0;
  return FormUploadButton({ formId: "f1", currentStatus });
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

async function pickFile(currentStatus: Status, file: FakeFile): Promise<string> {
  const onChange = findFileChange(render(currentStatus));
  assert.ok(onChange, "this state renders a file input");
  await onChange({ target: { files: [file] } });
  return renderToString(render(currentStatus));
}

function alertIn(html: string): { tag: string; text: string } {
  const match = /<p\b[^>]*role="alert"[^>]*>([^<]*)<\/p>/.exec(html);
  assert.ok(match, `no role="alert" message in: ${html}`);
  return { tag: match[0], text: match[1] };
}

const TOO_LARGE: FakeFile = { name: "scan.pdf", size: 12 * 1024 * 1024, type: "application/pdf" };

describe("FormUploadButton upload errors", () => {
  for (const status of ["pending", "rejected", null] as const) {
    it(`${status ?? "no submission"}: a file over 10 MB shows an inline alert`, async () => {
      const { tag, text } = alertIn(await pickFile(status, TOO_LARGE));
      assert.equal(text, "File too large (max 10 MB).");
      assert.match(tag, /text-\[var\(--badge-error-text\)\]/, "error text uses the theme-aware error token");
    });
  }

  it("rejected: a server refusal shows the server's message", async () => {
    mock.method(globalThis, "fetch", async () => ({
      ok: false,
      json: async () => ({ error: "This form is no longer accepting uploads." }),
    }));
    const small: FakeFile = { name: "form.pdf", size: 2048, type: "application/pdf" };
    const { text } = alertIn(await pickFile("rejected", small));
    assert.equal(text, "This form is no longer accepting uploads.");
  });
});
