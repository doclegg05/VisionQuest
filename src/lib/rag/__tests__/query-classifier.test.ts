import { describe, it } from "node:test";
import assert from "node:assert";
import { classifyQuery } from "../query-classifier";

// ---------------------------------------------------------------------------
// conversation_memory
// ---------------------------------------------------------------------------

describe("conversation_memory", () => {
  it("matches 'What did I say earlier?'", () => {
    assert.strictEqual(classifyQuery("What did I say earlier?"), "conversation_memory");
  });

  it("matches 'Remind me what we discussed'", () => {
    assert.strictEqual(classifyQuery("Remind me what we discussed"), "conversation_memory");
  });

  it("matches 'What did we talk about before?'", () => {
    assert.strictEqual(classifyQuery("What did we talk about before?"), "conversation_memory");
  });

  it("matches 'Earlier you said something about goals'", () => {
    assert.strictEqual(
      classifyQuery("Earlier you said something about goals"),
      "conversation_memory",
    );
  });

  it("matches 'Do you remember what I mentioned?'", () => {
    assert.strictEqual(
      classifyQuery("Do you remember what I mentioned?"),
      "conversation_memory",
    );
  });
});

// ---------------------------------------------------------------------------
// personal_status
// ---------------------------------------------------------------------------

describe("personal_status", () => {
  it("matches 'How am I doing on my goals?'", () => {
    assert.strictEqual(classifyQuery("How am I doing on my goals?"), "personal_status");
  });

  it("matches 'What certifications do I have?'", () => {
    assert.strictEqual(classifyQuery("What certifications do I have?"), "personal_status");
  });

  it("matches 'My progress so far'", () => {
    assert.strictEqual(classifyQuery("My progress so far"), "personal_status");
  });

  it("matches 'What are my goals?'", () => {
    assert.strictEqual(classifyQuery("What are my goals?"), "personal_status");
  });

  it("matches 'Am I on track?'", () => {
    assert.strictEqual(classifyQuery("Am I on track?"), "personal_status");
  });
});

// ---------------------------------------------------------------------------
// external_platform
// ---------------------------------------------------------------------------

describe("external_platform", () => {
  it("matches 'How do I log into GMetrix?'", () => {
    assert.strictEqual(classifyQuery("How do I log into GMetrix?"), "external_platform");
  });

  it("matches 'What is my Edgenuity password?'", () => {
    assert.strictEqual(classifyQuery("What is my Edgenuity password?"), "external_platform");
  });

  it("matches 'How to access Burlington English?'", () => {
    assert.strictEqual(
      classifyQuery("How to access Burlington English?"),
      "external_platform",
    );
  });

  it("matches 'I need to sign in to Certiport'", () => {
    assert.strictEqual(
      classifyQuery("I need to sign in to Certiport"),
      "external_platform",
    );
  });

  it("does NOT match platform name alone without access word", () => {
    assert.strictEqual(classifyQuery("Tell me about GMetrix"), "document");
  });

  it("does NOT match access word alone without platform name", () => {
    assert.strictEqual(classifyQuery("How do I log in?"), "document");
  });
});

// ---------------------------------------------------------------------------
// app_navigation
// ---------------------------------------------------------------------------

describe("app_navigation", () => {
  it("matches 'Where do I upload my resume?'", () => {
    assert.strictEqual(classifyQuery("Where do I upload my resume?"), "app_navigation");
  });

  it("matches 'How can I access my portfolio?'", () => {
    assert.strictEqual(classifyQuery("How can I access my portfolio?"), "app_navigation");
  });

  it("matches 'Where is the dashboard?'", () => {
    assert.strictEqual(classifyQuery("Where is the dashboard?"), "app_navigation");
  });

  it("matches 'How do I get to settings?'", () => {
    assert.strictEqual(classifyQuery("How do I get to settings?"), "app_navigation");
  });

  it("matches 'Where can I see my files?'", () => {
    assert.strictEqual(classifyQuery("Where can I see my files?"), "app_navigation");
  });
});

// ---------------------------------------------------------------------------
// mixed
// ---------------------------------------------------------------------------

describe("mixed", () => {
  it("matches 'What certifications do I still need?'", () => {
    assert.strictEqual(
      classifyQuery("What certifications do I still need?"),
      "mixed",
    );
  });

  it("matches 'Which forms have I completed?'", () => {
    assert.strictEqual(classifyQuery("Which forms have I completed?"), "mixed");
  });

  it("matches 'Do I meet the attendance requirements?'", () => {
    assert.strictEqual(
      classifyQuery("Do I meet the attendance requirements?"),
      "mixed",
    );
  });

  it("matches 'What is my RTW status?'", () => {
    // "my ... status" = personal_status (asking about own status, not RTW docs)
    assert.strictEqual(classifyQuery("What is my RTW status?"), "personal_status");
  });
});

// ---------------------------------------------------------------------------
// document (default)
// ---------------------------------------------------------------------------

describe("document", () => {
  it("matches 'What is IC3?'", () => {
    assert.strictEqual(classifyQuery("What is IC3?"), "document");
  });

  it("matches 'Tell me about WorkKeys'", () => {
    assert.strictEqual(classifyQuery("Tell me about WorkKeys"), "document");
  });

  it("matches 'What are the attendance requirements?'", () => {
    assert.strictEqual(
      classifyQuery("What are the attendance requirements?"),
      "document",
    );
  });

  it("matches 'Explain the Ready to Work certificate'", () => {
    assert.strictEqual(
      classifyQuery("Explain the Ready to Work certificate"),
      "document",
    );
  });

  it("matches 'What does SPOKES stand for?'", () => {
    assert.strictEqual(classifyQuery("What does SPOKES stand for?"), "document");
  });
});
