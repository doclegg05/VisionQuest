import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderToString } from "react-dom/server";

import { ReadAloudButton, pickLocalVoice } from "./ReadAloudButton";
import MessageBubble from "@/components/chat/MessageBubble";

/**
 * Read-aloud (Match & Connect Task 2.3).
 *
 * Two rules, both load-bearing:
 *  1. The button is HIDDEN, not disabled, when it cannot speak — a control that
 *     does nothing costs a slow reader a real attempt.
 *  2. It speaks ONLY through a voice with `localService: true`. The platform
 *     default may be network-backed, which would ship Sage's reply text — and a
 *     reply can quote what a student disclosed — to a speech vendor.
 *
 * These renders stub `speechSynthesis` rather than relying on its absence.
 * Without the stub every assertion here passes trivially: `renderToString` has
 * no window, so the button never renders and "it is not there" proves nothing.
 */

interface StubVoice {
  name: string;
  lang: string;
  localService: boolean;
  default?: boolean;
  voiceURI?: string;
}

function stubSpeech(voices: StubVoice[]) {
  const globalWithWindow = globalThis as { window?: unknown };
  globalWithWindow.window = {
    speechSynthesis: {
      getVoices: () => voices,
      cancel: () => {},
      speak: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
    },
  };
}

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

const LOCAL_EN: StubVoice = { name: "Samantha", lang: "en-US", localService: true };
const NETWORK_EN: StubVoice = { name: "Cloud Voice", lang: "en-US", localService: false };
const LOCAL_ES: StubVoice = { name: "Mónica", lang: "es-ES", localService: true };

describe("pickLocalVoice", () => {
  it("picks the first on-device English voice", () => {
    assert.equal(pickLocalVoice([NETWORK_EN, LOCAL_EN])?.name, "Samantha");
  });

  it("returns null when every English voice is network-backed", () => {
    // A network voice would send the reply text — which can quote a student's
    // own disclosure — to a speech vendor. Silence is the correct outcome.
    assert.equal(pickLocalVoice([NETWORK_EN]), null);
  });

  it("returns null when the only on-device voice is not English", () => {
    assert.equal(pickLocalVoice([LOCAL_ES]), null);
  });

  it("returns null for an empty voice list", () => {
    assert.equal(pickLocalVoice([]), null);
  });
});

describe("ReadAloudButton", () => {
  it("renders the control when an on-device English voice exists", () => {
    stubSpeech([LOCAL_EN]);
    const html = renderToString(<ReadAloudButton text="Production Associate at Mountain Metal." />);
    assert.ok(html.includes("Read out loud"), "the control should be offered");
  });

  it("renders nothing when speech synthesis is unavailable", () => {
    const html = renderToString(<ReadAloudButton text="Production Associate at Mountain Metal." />);
    assert.equal(html, "");
  });

  it("renders nothing when only a network-backed voice is available", () => {
    stubSpeech([NETWORK_EN]);
    const html = renderToString(<ReadAloudButton text="Production Associate at Mountain Metal." />);
    assert.equal(html, "", "no on-device voice means no button, not a silent one");
  });

  it("renders nothing for empty text even where it is supported", () => {
    stubSpeech([LOCAL_EN]);
    assert.equal(renderToString(<ReadAloudButton text="   " />), "");
  });
});

describe("read-aloud placement", () => {
  it("is offered on Sage's finished replies, not on the student's own messages", () => {
    stubSpeech([LOCAL_EN]);
    const sage = renderToString(
      <MessageBubble role="assistant" content="Here is the job in plain words." />,
    );
    const student = renderToString(<MessageBubble role="user" content="What jobs fit me?" />);
    assert.ok(sage.includes("Read out loud"), "Sage's reply should offer read-aloud");
    assert.ok(!student.includes("Read out loud"), "the student's own message should not");
  });

  it("is not offered while a reply is still streaming", () => {
    stubSpeech([LOCAL_EN]);
    const html = renderToString(
      <MessageBubble role="assistant" content="Here is the job" isStreaming />,
    );
    assert.ok(!html.includes("Read out loud"));
  });
});
