import assert from "node:assert/strict";
import { it, mock } from "node:test";
import { GeminiProvider } from "@/lib/ai/gemini-provider";
import { extractionTranscript } from "./extraction-transcript";

it("sends a truncated model-first transcript through the real Gemini SDK without relabeling", async () => {
  const transcript = [
    { role: "model" as const, content: "What work interests you?" },
    { role: "user" as const, content: "Repairing computers." },
    { role: "model" as const, content: "Let's explore IT support." },
  ];
  const fetchMock = mock.method(globalThis, "fetch", async () => Response.json({
    candidates: [{ content: { role: "model", parts: [{ text: "{}" }] } }],
  }));
  try {
    const result = await new GeminiProvider("fake-test-key").generateStructuredResponse(
      "Extract only student-supported facts.", extractionTranscript(transcript, "Extract the facts now."),
    );
    assert.equal(result, "{}");
    const body = JSON.parse(String(fetchMock.mock.calls[0].arguments[1]?.body));
    assert.deepEqual(body.contents.map((entry: {role: string}) => entry.role), ["user", "model", "user", "model", "user"]);
    assert.deepEqual(body.contents.slice(1, -1).map((entry: {role: string; parts: {text: string}[]}) => ({role: entry.role, content: entry.parts[0].text})), transcript);
  } finally { fetchMock.mock.restore(); }
});

it("keeps the original user start and appends an actual extraction request", () => {
  const transcript = [{role: "user" as const, content: "I use the bus."}, {role: "model" as const, content: "Thanks for explaining."}];
  const input = extractionTranscript(transcript, "Extract memories.");
  assert.deepEqual(input.slice(0, -1), transcript);
  assert.deepEqual(input.at(-1), {role: "user", content: "Extract memories."});
  assert.equal(transcript.length, 2);
});
