import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { assessReadability, PLAIN_LANGUAGE_MAX_GRADE } from "@/lib/sage/readability";

import {
  CONNECTION_STATUSES,
  STUDENT_VISIBLE_CONNECTION_STATUSES,
  connectionStatusPhrase,
  isTerminalConnectionStatus,
  withdrawConfirmation,
  type ConnectionStatus,
} from "./pipeline-shared";

const EMPLOYER = "Mountain Metal";

describe("connectionStatusPhrase", () => {
  it("has a phrase for every status, with no raw enum leaking through", () => {
    for (const status of CONNECTION_STATUSES) {
      const phrase = connectionStatusPhrase(status, EMPLOYER);
      assert.ok(phrase.length > 0, `${status} has no phrase`);
      // A student must never be shown "interview_scheduled" or "not_now".
      assert.ok(!phrase.includes("_"), `${status} leaked its enum value: "${phrase}"`);
    }
  });

  it("names the employer where the employer is the one who acted", () => {
    assert.match(connectionStatusPhrase("sent", EMPLOYER), /Mountain Metal/);
    assert.match(connectionStatusPhrase("viewed", EMPLOYER), /Mountain Metal/);
    assert.match(connectionStatusPhrase("interested", EMPLOYER), /Mountain Metal/);
    assert.match(connectionStatusPhrase("not_now", EMPLOYER), /Mountain Metal/);
  });

  it("says who the student is waiting on before it is sent", () => {
    // The single most common question between approving and sending is "did
    // anything happen yet", and the honest answer names the teacher.
    assert.match(connectionStatusPhrase("student_approved", EMPLOYER), /teacher/i);
  });

  it("reads at or below the plain-language ceiling", () => {
    for (const status of CONNECTION_STATUSES) {
      const phrase = connectionStatusPhrase(status, EMPLOYER);
      const grade = assessReadability(phrase, { maxGrade: PLAIN_LANGUAGE_MAX_GRADE });
      assert.ok(grade.withinTarget, `"${phrase}" reads at grade ${grade.grade}`);
    }
  });

  it("survives a missing employer name without printing 'undefined'", () => {
    for (const status of CONNECTION_STATUSES) {
      const phrase = connectionStatusPhrase(status, "");
      assert.ok(!phrase.toLowerCase().includes("undefined"), status);
      assert.ok(!phrase.includes("  "), `${status} left a gap where the name was`);
    }
  });
});

describe("STUDENT_VISIBLE_CONNECTION_STATUSES", () => {
  it("covers the whole gap between approval and an answer", () => {
    // C1: between approving and sending, a student had NO page showing the
    // connection existed, while the card had promised they could take it back.
    for (const status of [
      "student_approved",
      "sent",
      "viewed",
      "interested",
      "interview_scheduled",
      "offered",
    ] as const) {
      assert.ok(
        (STUDENT_VISIBLE_CONNECTION_STATUSES as readonly string[]).includes(status),
        `${status} is invisible to the student it is about`,
      );
    }
  });

  it("excludes 'proposed', which belongs to the approval card", () => {
    assert.ok(!(STUDENT_VISIBLE_CONNECTION_STATUSES as readonly string[]).includes("proposed"));
  });

  it("is exactly the non-terminal statuses after approval", () => {
    const expected = CONNECTION_STATUSES.filter(
      (status) => status !== "proposed" && !isTerminalConnectionStatus(status),
    );
    assert.deepEqual([...STUDENT_VISIBLE_CONNECTION_STATUSES], expected);
    // Every one of them is therefore withdrawable, which is what makes a
    // "Take this back" button on each row honest.
    for (const status of STUDENT_VISIBLE_CONNECTION_STATUSES) {
      assert.equal(isTerminalConnectionStatus(status), false, status);
    }
  });
});

describe("withdrawConfirmation", () => {
  it("says nothing left the program when it never had", () => {
    assert.equal(
      withdrawConfirmation("student_approved", EMPLOYER),
      "Done. We told your teacher not to send this.",
    );
  });

  it("names the employer once the packet has actually gone", () => {
    for (const status of ["sent", "viewed", "interested", "interview_scheduled", "offered"] as const) {
      const message = withdrawConfirmation(status, EMPLOYER);
      assert.match(message, /Mountain Metal/, status);
      assert.match(message, /changed your mind/, status);
      // It must NOT claim nothing was sent, because something was.
      assert.ok(!message.includes("not to send"), status);
    }
  });

  it("reads at or below the plain-language ceiling", () => {
    for (const status of STUDENT_VISIBLE_CONNECTION_STATUSES) {
      const message = withdrawConfirmation(status as ConnectionStatus, EMPLOYER);
      const grade = assessReadability(message, { maxGrade: PLAIN_LANGUAGE_MAX_GRADE });
      assert.ok(grade.withinTarget, `"${message}" reads at grade ${grade.grade}`);
    }
  });
});
