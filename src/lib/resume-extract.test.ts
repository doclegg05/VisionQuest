import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AIProvider } from "@/lib/ai";
import { extractResumeFromText } from "./resume-extract";

// FERPA review §2.c.3 (2026-09-06): the raw résumé text IS the payload and
// cannot be stripped without losing the body, so this path stays lane
// `batch` (Ticket 1A's policy switch decides where it may run). What it can
// stop doing is prefixing the student's display name — the parser does not
// need it, and it was one more identifier per call.

function capturingProvider(reply: unknown): AIProvider & { sent: { system: string; user: string } } {
  const sent = { system: "", user: "" };
  const provider = {
    name: "mock-model",
    sent,
    generateResponse: async () => "",
    streamResponse: async function* () {},
    generateStructuredResponse: async (system: string, messages: Array<{ content: string }>) => {
      sent.system = system;
      sent.user = messages.map((m) => m.content).join("\n");
      return JSON.stringify(reply);
    },
  };
  return provider as unknown as AIProvider & { sent: { system: string; user: string } };
}

const RAW = [
  "Tanesha Rivers",
  "Beckley, WV | (304) 555-0142 | tanesha@example.org",
  "",
  "EXPERIENCE",
  "Cashier, Kroger, 2023-2025",
].join("\n");

describe("extractResumeFromText", () => {
  it("does not prefix the message with a Student name line", async () => {
    const provider = capturingProvider({ resume: {}, improvements: [], notes: "" });
    await extractResumeFromText(provider, RAW);
    assert.ok(!/Student name:/.test(provider.sent.user), provider.sent.user);
  });

  it("still sends the raw résumé text — it is the payload", async () => {
    const provider = capturingProvider({ resume: {}, improvements: [], notes: "" });
    await extractResumeFromText(provider, RAW);
    assert.ok(provider.sent.user.includes("Cashier, Kroger, 2023-2025"));
  });

  it("returns the parsed résumé, improvements and notes", async () => {
    const provider = capturingProvider({
      resume: { headline: "Cashier", contact: { email: "tanesha@example.org" } },
      improvements: ["Add measurable achievements to your cashier role", 42, ""],
      notes: "Solid start.",
    });
    const result = await extractResumeFromText(provider, RAW);
    assert.equal(result.resume.headline, "Cashier");
    assert.equal(result.resume.contact.email, "tanesha@example.org");
    assert.deepEqual(result.improvements, ["Add measurable achievements to your cashier role"]);
    assert.equal(result.notes, "Solid start.");
  });
});
