import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  SYSTEMONE_DEFAULT_BASE,
  TypeSafeError,
  callSystemOne,
  choiceQuestion,
  parseChoiceAnswer,
} from "./typesafe-client.mjs";

const KEY = "ts_live_example_key_0123456789";

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  };
}

function recordingFetch(responses) {
  const calls = [];
  const queue = [...responses];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    const next = queue.shift();
    if (!next) throw new Error("no more fake responses");
    return next;
  };
  return { fetchImpl, calls };
}

const OK_BODY = {
  model: "jev-1.13.0",
  provider: "TypeSafe",
  answers: {
    spokes: {
      type: "choice",
      choice: "office-admin",
      probabilities: { "office-admin": 0.7, "tech-digital": 0.3 },
      confidence: 0.5,
    },
  },
  usage: { input_tokens: 400, output_tokens: 10 },
};

describe("choiceQuestion", () => {
  it("keeps option order and passes null descriptions through", () => {
    const question = choiceQuestion("Which fits?", [
      { key: "b", description: "Second" },
      { key: "a", description: null },
    ]);
    assert.equal(question.type, "choice");
    assert.equal(question.instructions, "Which fits?");
    assert.deepEqual(Object.keys(question.criteria), ["b", "a"]);
    assert.equal(question.criteria.a, null);
  });

  it("refuses duplicate keys and more than 255 options", () => {
    assert.throws(() =>
      choiceQuestion("x", [
        { key: "a", description: null },
        { key: "a", description: null },
      ]),
    );
    const tooMany = Array.from({ length: 256 }, (_, i) => ({ key: `k${i}`, description: null }));
    assert.throws(() => choiceQuestion("x", tooMany));
  });
});

describe("parseChoiceAnswer", () => {
  const keys = ["office-admin", "tech-digital", "creative-design"];

  it("returns a probability for every option, filling missing ones with 0", () => {
    const parsed = parseChoiceAnswer(OK_BODY.answers.spokes, keys);
    assert.equal(parsed.choice, "office-admin");
    assert.deepEqual(parsed.probabilities, {
      "office-admin": 0.7,
      "tech-digital": 0.3,
      "creative-design": 0,
    });
    assert.equal(parsed.confidence, 0.5);
  });

  it("rejects a choice that is not one of the options", () => {
    assert.throws(
      () => parseChoiceAnswer({ ...OK_BODY.answers.spokes, choice: "finance" }, keys),
      TypeSafeError,
    );
  });

  it("renormalizes probabilities that two-decimal rounding leaves just short of 1", () => {
    // The live bake-off's office-admin-01-es answer summed to 0.990 and was
    // rejected, which scored a probably-correct answer as a failed case.
    const parsed = parseChoiceAnswer(
      { choice: "office-admin", probabilities: { "office-admin": 0.66, "tech-digital": 0.33 }, confidence: 0.5 },
      keys,
    );
    const total = Object.values(parsed.probabilities).reduce((sum, value) => sum + value, 0);
    assert.ok(Math.abs(total - 1) < 1e-9, String(total));
    assert.ok(Math.abs(parsed.probabilities["office-admin"] - 0.66 / 0.99) < 1e-9);
    assert.equal(parsed.choice, "office-admin");
  });

  it("rejects probabilities that are missing, non-numeric, or do not sum to 1", () => {
    assert.throws(() => parseChoiceAnswer({ choice: "office-admin" }, keys), TypeSafeError);
    assert.throws(
      () =>
        parseChoiceAnswer(
          { choice: "office-admin", probabilities: { "office-admin": "high" }, confidence: 1 },
          keys,
        ),
      TypeSafeError,
    );
    assert.throws(
      () =>
        parseChoiceAnswer(
          { choice: "office-admin", probabilities: { "office-admin": 0.5 }, confidence: 1 },
          keys,
        ),
      TypeSafeError,
    );
  });
});

describe("callSystemOne", () => {
  const request = {
    apiKey: KEY,
    model: "jev-1.13.0",
    state: [{ speaker: "Student", text: "I like spreadsheets." }],
    questions: { spokes: choiceQuestion("Which fits?", [{ key: "office-admin", description: null }]) },
    sleep: async () => {},
  };

  it("posts the documented body to /v1/systemone with a bearer key", async () => {
    const { fetchImpl, calls } = recordingFetch([jsonResponse(200, OK_BODY)]);
    const result = await callSystemOne({ ...request, fetchImpl });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://openrouter.ai/api/v1/systemone");
    assert.equal(SYSTEMONE_DEFAULT_BASE, "https://openrouter.ai/api");
    assert.equal(calls[0].init.method, "POST");
    assert.equal(calls[0].init.headers.Authorization, `Bearer ${KEY}`);
    assert.ok(calls[0].init.signal, "every request carries an abort signal");
    assert.deepEqual(JSON.parse(calls[0].init.body), {
      model: request.model,
      state: request.state,
      questions: request.questions,
    });
    assert.deepEqual(result.answers, OK_BODY.answers);
    assert.deepEqual(result.usage, OK_BODY.usage);
    assert.equal(typeof result.latencyMs, "number");
    assert.equal(result.upstreamProvider, "TypeSafe");
  });

  it("retries 429 and 529, then succeeds", async () => {
    const slept = [];
    const { fetchImpl, calls } = recordingFetch([
      jsonResponse(429, { error: "slow down" }),
      jsonResponse(529, { error: "overloaded" }),
      jsonResponse(200, OK_BODY),
    ]);
    await callSystemOne({ ...request, fetchImpl, sleep: async (ms) => slept.push(ms) });
    assert.equal(calls.length, 3);
    assert.equal(slept.length, 2);
    assert.ok(slept[1] > slept[0], "backoff grows");
  });

  it("gives up after maxRetries on a retryable status", async () => {
    const { fetchImpl, calls } = recordingFetch([
      jsonResponse(529, {}),
      jsonResponse(529, {}),
      jsonResponse(529, {}),
    ]);
    await assert.rejects(
      callSystemOne({ ...request, fetchImpl, maxRetries: 2 }),
      (error) => error instanceof TypeSafeError && error.status === 529,
    );
    assert.equal(calls.length, 3);
  });

  it("does not retry a validation error, and never puts the key in the message", async () => {
    const { fetchImpl, calls } = recordingFetch([
      jsonResponse(422, { detail: `bad questions for ${KEY}` }),
    ]);
    await assert.rejects(callSystemOne({ ...request, fetchImpl }), (error) => {
      assert.ok(error instanceof TypeSafeError);
      assert.equal(error.status, 422);
      assert.equal(error.message.includes(KEY), false, error.message);
      return true;
    });
    assert.equal(calls.length, 1);
  });

  it("refuses to call without a key", async () => {
    const { fetchImpl, calls } = recordingFetch([jsonResponse(200, OK_BODY)]);
    await assert.rejects(callSystemOne({ ...request, apiKey: "", fetchImpl }), TypeSafeError);
    assert.equal(calls.length, 0);
  });
});

describe("callSystemOne refuses the app server", () => {
  it("rejects without calling the network when NEXT_RUNTIME is set", async () => {
    const previous = process.env.NEXT_RUNTIME;
    process.env.NEXT_RUNTIME = "nodejs";
    const { fetchImpl, calls } = recordingFetch([jsonResponse(200, OK_BODY)]);
    try {
      await assert.rejects(
        callSystemOne({ apiKey: KEY, model: "typesafe/jev-1.13", state: "x", questions: {}, fetchImpl }),
        (error) => error instanceof TypeSafeError && /eval-only/.test(error.message),
      );
      assert.equal(calls.length, 0);
    } finally {
      if (previous === undefined) delete process.env.NEXT_RUNTIME;
      else process.env.NEXT_RUNTIME = previous;
    }
  });
});
