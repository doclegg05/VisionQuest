import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  extractOfferedFormIds,
  formCommitmentReply,
  isFormCommitmentMessage,
  resolveFormCommitment,
} from "./form-commitment";

describe("isFormCommitmentMessage", () => {
  it("accepts short affirmations", () => {
    for (const msg of [
      "Yes",
      "yes!",
      "Sure",
      "let's do it",
      "Lets do it",
      "all of them",
      "sounds good",
      "go ahead",
      "ok",
      "okay.",
    ]) {
      assert.equal(isFormCommitmentMessage(msg), true, msg);
    }
  });

  it("rejects longer or unrelated messages", () => {
    assert.equal(isFormCommitmentMessage("Can you provide it to me?"), false);
    assert.equal(isFormCommitmentMessage("What do I need to do today"), false);
    assert.equal(isFormCommitmentMessage(""), false);
  });
});

describe("extractOfferedFormIds", () => {
  it("extracts formId from download URLs in order", () => {
    const text =
      "Your [SPOKES Student Profile](/api/forms/download?formId=student-profile&mode=view) " +
      "and [Rights and Responsibilities](/api/forms/download?formId=rights-responsibilities&mode=view) are pending.";
    assert.deepEqual(extractOfferedFormIds(text), [
      "student-profile",
      "rights-responsibilities",
    ]);
  });

  it("extracts from titles when URLs are absent", () => {
    const text =
      "Would you like to start with the SPOKES Student Profile or Rights and Responsibilities?";
    const ids = extractOfferedFormIds(text);
    assert.ok(ids.includes("student-profile"));
    assert.ok(ids.includes("rights-responsibilities"));
  });
});

describe("resolveFormCommitment", () => {
  it("returns the first offered form on yes", () => {
    const prior =
      "Start with the [SPOKES Student Profile](/api/forms/download?formId=student-profile&mode=view) " +
      "or [Rights and Responsibilities](/api/forms/download?formId=rights-responsibilities&mode=view)?";
    const resolved = resolveFormCommitment("Yes", prior);
    assert.ok(resolved);
    assert.equal(resolved!.formId, "student-profile");
    assert.equal(resolved!.title, "SPOKES Student Profile");
  });

  it("returns null when prior turn offered no form", () => {
    assert.equal(resolveFormCommitment("Yes", "How are you feeling today?"), null);
  });

  it("returns null for non-commitment messages even with a form offer", () => {
    const prior =
      "[SPOKES Student Profile](/api/forms/download?formId=student-profile&mode=view)";
    assert.equal(resolveFormCommitment("Can you provide it to me?", prior), null);
  });
});

describe("formCommitmentReply", () => {
  it("mentions the next form when more are pending", () => {
    assert.match(
      formCommitmentReply("SPOKES Student Profile", true),
      /next one/i,
    );
  });

  it("omits queue language for a single form", () => {
    const reply = formCommitmentReply("SPOKES Student Profile", false);
    assert.match(reply, /SPOKES Student Profile/);
    assert.ok(!/next one/i.test(reply));
  });
});
