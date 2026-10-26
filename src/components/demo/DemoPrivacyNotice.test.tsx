import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderToString } from "react-dom/server";
import ChatInput from "@/components/chat/ChatInput";
import { DEMO_PRIVACY_NOTICE } from "@/lib/demo/copy";
import { DemoAccountProvider } from "./DemoAccountContext";
import { DemoPrivacyNotice } from "./DemoPrivacyNotice";

// In the demo the shared instructor account can read what every demo student
// types to Sage. The owner chose to show that to the instructor and warn the
// students instead, so the warning has to appear next to the place they type,
// for a demo student and nobody else.

const NOTICE_MARKUP = `role="note"`;

function renderChatInput(value: "student" | "instructor" | null | "no-provider"): string {
  const input = <ChatInput onSend={() => {}} />;
  if (value === "no-provider") return renderToString(input);
  return renderToString(<DemoAccountProvider value={value}>{input}</DemoAccountProvider>);
}

describe("DemoPrivacyNotice", () => {
  it("renders the notice text", () => {
    const html = renderToString(<DemoPrivacyNotice />);

    assert.ok(html.startsWith("<p"), `expected a paragraph, got: ${html}`);
    assert.ok(html.includes(NOTICE_MARKUP), `expected role="note", got: ${html}`);
    assert.ok(html.includes(DEMO_PRIVACY_NOTICE), `expected the notice text, got: ${html}`);
  });

  it("is small muted text, never smaller than text-sm", () => {
    const html = renderToString(<DemoPrivacyNotice />);

    assert.match(html, /class="[^"]*\btext-sm\b/);
    assert.match(html, /class="[^"]*text-\[var\(--ink-muted\)\]/);
  });
});

describe("ChatInput and the demo privacy notice", () => {
  it("ChatInput shows the notice only for a demo student", () => {
    const forStudent = renderChatInput("student");
    const forInstructor = renderChatInput("instructor");
    const forNobody = renderChatInput(null);

    assert.ok(forStudent.includes(DEMO_PRIVACY_NOTICE), "a demo student should see the notice");
    assert.ok(!forInstructor.includes(DEMO_PRIVACY_NOTICE), "a demo instructor should not");
    assert.ok(!forNobody.includes(DEMO_PRIVACY_NOTICE), "a real account should not");
  });

  it("ChatInput renders nothing extra with no provider, as on the teacher side", () => {
    const html = renderChatInput("no-provider");

    assert.ok(!html.includes(DEMO_PRIVACY_NOTICE));
    assert.ok(!html.includes(NOTICE_MARKUP));
  });

  it("puts the notice after the message box, not before it", () => {
    const html = renderChatInput("student");

    const box = html.indexOf(`aria-label="Message to Sage"`);
    const notice = html.indexOf(DEMO_PRIVACY_NOTICE);
    assert.ok(box !== -1, "the message box should render");
    assert.ok(notice > box, "the notice should sit under the message box");
  });
});
