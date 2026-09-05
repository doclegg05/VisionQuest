import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  SMS_DAILY_CAP,
  SMS_MAX_LENGTH,
  SMS_PREFIX,
  SMS_REFUSAL,
  SMS_STOP_SUFFIX,
  SMS_TIME_ZONE,
  buildHeardBackSms,
  buildInterviewConfirmSms,
  buildInterviewDeclineAckSms,
  buildRetentionSms,
  buildWeeklyJobsSms,
  canSendSms,
  classifyInboundSms,
  composeSmsBody,
  isQuietHour,
  nextSendWindowStart,
  redactLinks,
  sanitizeSmsValue,
  zonedDayKey,
  zonedHour,
  type SmsPreferenceSnapshot,
} from "./sms-policy-shared";

const CONSENTED: SmsPreferenceSnapshot = {
  enabled: true,
  destination: "+13045550123",
  smsConsentAt: new Date("2026-08-01T12:00:00Z"),
  smsRevokedAt: null,
};

/** 2026-09-08 is a Tuesday. 14:00Z = 10:00 EDT — inside the send window. */
const MIDMORNING = new Date("2026-09-08T14:00:00Z");

describe("quiet hours are read in America/New_York, not UTC", () => {
  it("names the zone it claims to use", () => {
    assert.equal(SMS_TIME_ZONE, "America/New_York");
  });

  it("10:00 ET is not a quiet hour, and the same instant in UTC is 14:00", () => {
    assert.equal(zonedHour(MIDMORNING), 10);
    assert.equal(isQuietHour(MIDMORNING), false);
  });

  it("21:00 ET is the first quiet hour and 07:59 ET is the last", () => {
    // 2026-09-08 21:00 EDT = 2026-09-09 01:00Z
    assert.equal(isQuietHour(new Date("2026-09-09T00:59:00Z")), false, "20:59 ET must be sendable");
    assert.equal(isQuietHour(new Date("2026-09-09T01:00:00Z")), true, "21:00 ET must be quiet");
    // 2026-09-09 07:59 EDT = 11:59Z; 08:00 EDT = 12:00Z
    assert.equal(isQuietHour(new Date("2026-09-09T11:59:00Z")), true);
    assert.equal(isQuietHour(new Date("2026-09-09T12:00:00Z")), false);
  });

  it("spring forward, 2026-03-08: 01:30 EST is quiet and the window opens at 08:00 EDT (12:00Z)", () => {
    const beforeTheGap = new Date("2026-03-08T06:30:00Z"); // 01:30 EST
    assert.equal(zonedHour(beforeTheGap), 1);
    assert.equal(isQuietHour(beforeTheGap), true);
    assert.equal(
      nextSendWindowStart(beforeTheGap).toISOString(),
      "2026-03-08T12:00:00.000Z",
      "after the 2am jump the offset is -04:00, so 08:00 local is 12:00Z",
    );
  });

  it("fall back, 2026-11-01: 01:30 EDT is quiet and the window opens at 08:00 EST (13:00Z)", () => {
    const duringTheRepeat = new Date("2026-11-01T05:30:00Z"); // 01:30 EDT
    assert.equal(zonedHour(duringTheRepeat), 1);
    assert.equal(isQuietHour(duringTheRepeat), true);
    assert.equal(
      nextSendWindowStart(duringTheRepeat).toISOString(),
      "2026-11-01T13:00:00.000Z",
      "after the 2am fall back the offset is -05:00, so 08:00 local is 13:00Z",
    );
  });

  it("a late-evening instant defers to the next morning of the SAME local day key", () => {
    const lateFriday = new Date("2026-10-31T02:30:00Z"); // 2026-10-30 22:30 EDT
    assert.equal(zonedDayKey(lateFriday), "2026-10-30");
    assert.equal(isQuietHour(lateFriday), true);
    assert.equal(
      nextSendWindowStart(lateFriday).toISOString(),
      "2026-10-31T12:00:00.000Z",
      "22:30 on the 30th is past that day's window, so the next one is the 31st",
    );
  });
});

describe("canSendSms", () => {
  it("refuses when there is no preference row at all", () => {
    assert.deepEqual(canSendSms({ pref: null, now: MIDMORNING, sentTodayCount: 0 }), {
      decision: "refuse",
      reason: SMS_REFUSAL.noPreference,
    });
  });

  it("refuses without a recorded consent even when the channel is enabled", () => {
    const result = canSendSms({
      pref: { ...CONSENTED, smsConsentAt: null },
      now: MIDMORNING,
      sentTodayCount: 0,
    });
    assert.deepEqual(result, { decision: "refuse", reason: SMS_REFUSAL.noConsent });
  });

  it("refuses after a revocation even when consent was once recorded", () => {
    const result = canSendSms({
      pref: { ...CONSENTED, smsRevokedAt: new Date("2026-09-01T00:00:00Z") },
      now: MIDMORNING,
      sentTodayCount: 0,
    });
    assert.deepEqual(result, { decision: "refuse", reason: SMS_REFUSAL.revoked });
  });

  it("refuses when the channel is switched off, and when there is no number", () => {
    assert.equal(
      canSendSms({ pref: { ...CONSENTED, enabled: false }, now: MIDMORNING, sentTodayCount: 0 })
        .decision,
      "refuse",
    );
    const noNumber = canSendSms({
      pref: { ...CONSENTED, destination: null },
      now: MIDMORNING,
      sentTodayCount: 0,
    });
    assert.deepEqual(noNumber, { decision: "refuse", reason: SMS_REFUSAL.noDestination });
  });

  it("allows a consenting recipient inside the window under the cap", () => {
    assert.deepEqual(canSendSms({ pref: CONSENTED, now: MIDMORNING, sentTodayCount: 1 }), {
      decision: "allow",
    });
  });

  it("defers inside quiet hours instead of refusing", () => {
    const atNight = new Date("2026-09-09T02:00:00Z"); // 22:00 EDT on the 8th
    const result = canSendSms({ pref: CONSENTED, now: atNight, sentTodayCount: 0 });
    assert.equal(result.decision, "defer");
    assert.equal(result.decision === "defer" && result.reason, SMS_REFUSAL.quietHours);
    assert.equal(
      result.decision === "defer" && result.until.toISOString(),
      "2026-09-09T12:00:00.000Z",
    );
  });

  it("defers to tomorrow once the daily cap is reached", () => {
    assert.equal(SMS_DAILY_CAP, 2);
    const result = canSendSms({
      pref: CONSENTED,
      now: MIDMORNING,
      sentTodayCount: SMS_DAILY_CAP,
    });
    assert.equal(result.decision, "defer");
    assert.equal(result.decision === "defer" && result.reason, SMS_REFUSAL.dailyCap);
    assert.equal(
      result.decision === "defer" && result.until.toISOString(),
      "2026-09-09T12:00:00.000Z",
      "the cap clears at the start of the next local day's send window",
    );
  });

  it("takes the LATER of the two deferrals when the cap is hit at night", () => {
    const atNight = new Date("2026-09-09T02:00:00Z"); // 22:00 EDT on the 8th
    const result = canSendSms({ pref: CONSENTED, now: atNight, sentTodayCount: SMS_DAILY_CAP });
    assert.equal(
      result.decision === "defer" && result.until.toISOString(),
      "2026-09-09T12:00:00.000Z",
    );
  });

  it("a consent problem outranks a timing problem — it is never merely deferred", () => {
    const atNight = new Date("2026-09-09T02:00:00Z");
    assert.equal(
      canSendSms({ pref: { ...CONSENTED, smsConsentAt: null }, now: atNight, sentTodayCount: 5 })
        .decision,
      "refuse",
    );
  });
});

describe("every body names SPOKES, carries the opt-out, and fits one segment", () => {
  const bodies = [
    buildWeeklyJobsSms(5),
    buildWeeklyJobsSms(120),
    buildInterviewConfirmSms({ employerName: "Mountain Metals", when: "Tue 10:00 AM" }),
    buildInterviewConfirmSms({
      employerName: "A Very Long Employer Name That Nobody Would Ever Type But Someone Will",
      when: "Wednesday 9:30 AM",
    }),
    buildHeardBackSms("Production Associate"),
    buildHeardBackSms("Overnight Sanitation Associate, Second Shift, Weekend Rotation"),
    buildRetentionSms("Mountain Metals"),
    buildRetentionSms("Appalachian Regional Healthcare System of Southern West Virginia"),
  ];

  it("starts with SPOKES: and ends with the STOP line", () => {
    for (const body of bodies) {
      assert.ok(body.startsWith(`${SMS_PREFIX} `), `missing prefix: ${body}`);
      assert.ok(body.endsWith(SMS_STOP_SUFFIX), `missing STOP line: ${body}`);
    }
  });

  it("never exceeds one 160-character segment, even with a long employer name", () => {
    assert.equal(SMS_MAX_LENGTH, 160);
    for (const body of bodies) {
      assert.ok(body.length <= SMS_MAX_LENGTH, `${body.length} chars: ${body}`);
    }
  });

  it("says the thing the plan promised for the weekly nudge, and points at Career", () => {
    assert.equal(
      buildWeeklyJobsSms(5),
      "SPOKES: 5 new jobs near you this week. Reply Y to see them on your Career page. Reply STOP to stop.",
    );
  });

  it("tells the student where to get the interview address", () => {
    const body = buildInterviewConfirmSms({
      employerName: "Mountain Metals",
      when: "Tue 10:00 AM",
    });
    assert.match(body, /Interview with Mountain Metals, Tue 10:00 AM\./);
    assert.match(body, /Ask your teacher for the address\./);
  });

  it("fits a 64-character employer name into one segment, address line intact", () => {
    const sixtyFour = "Appalachian Regional Healthcare System of Southern West Virgin";
    const body = buildInterviewConfirmSms({ employerName: sixtyFour, when: "Wed 9:30 AM" });
    assert.ok(body.length <= SMS_MAX_LENGTH, `${body.length} chars: ${body}`);
    assert.match(body, /Ask your teacher for the address\./, "the fixed text must survive");
    assert.match(body, /Wed 9:30 AM/, "the time must survive");
  });

  it("says what N does in the retention text", () => {
    assert.match(buildRetentionSms("Mountain Metals"), /If no, your coach will reach out\./);
  });

  it("acknowledges an interview decline", () => {
    assert.equal(
      buildInterviewDeclineAckSms(),
      "SPOKES: Got it. Your teacher will call you. Reply STOP to stop.",
    );
  });

  it("is plain ASCII everywhere, so no body flips to UCS-2 (70-char segments)", () => {
    for (const body of [...bodies, buildInterviewDeclineAckSms(), buildWeeklyJobsSms(1)]) {
        assert.doesNotMatch(body, /[^\u0000-\u007f]/, `non-ASCII in: ${body}`);
    }
  });

  it("names the employer in the retention check-in", () => {
    assert.match(buildRetentionSms("Mountain Metals"), /Still working at Mountain Metals\?/);
  });

  it("refuses to compose a body that cannot fit", () => {
    assert.throws(() => composeSmsBody("x".repeat(200)), /160/);
  });
});

describe("classifyInboundSms", () => {
  it("treats every documented stop keyword as a stop, in any case", () => {
    for (const word of ["STOP", "stop", " Stop ", "UNSUBSCRIBE", "cancel", "End", "quit"]) {
      assert.equal(classifyInboundSms(word), "stop", word);
    }
  });

  it("reads NO as an answer, not as noise", () => {
    // "N" and "NO" are the same word to a person. Treating NO as unknown
    // discarded the very answer the retention question exists to capture.
    for (const word of ["N", "n!", "NO", "no", "Nope"]) {
      assert.equal(classifyInboundSms(word), "no", word);
    }
  });

  it("resolves YES by context, and keeps bare Y an answer either way", () => {
    // Twilio treats YES as an opt-in keyword; a student answering "Still
    // working at X?" also types it. Only an open question tells them apart.
    assert.equal(classifyInboundSms("YES"), "start", "no question pending");
    assert.equal(classifyInboundSms("yes", { hasPendingQuestion: true }), "yes");
    assert.equal(classifyInboundSms("Y"), "yes");
    assert.equal(classifyInboundSms("Y", { hasPendingQuestion: true }), "yes");
    assert.equal(classifyInboundSms("START", { hasPendingQuestion: true }), "start");
  });

  it("anything else is unknown — a sentence is not a silent opt-out", () => {
    assert.equal(classifyInboundSms("stop texting me about the job"), "unknown");
    assert.equal(classifyInboundSms(""), "unknown");
    assert.equal(classifyInboundSms("yes please send them"), "unknown");
  });
});

describe("sanitizeSmsValue — third-party text inside a message we sign", () => {
  it("strips a newline forge, a NUL, and an ESC", () => {
    assert.equal(
      sanitizeSmsValue("Acme\nSPOKES: your account is locked"),
      "Acme SPOKES your account is locked",
    );
    assert.equal(sanitizeSmsValue("Ac\u0000me"), "Ac me");
    assert.equal(sanitizeSmsValue("Ac\u001bme"), "Ac me");
  });

  it("strips a bidi override and a zero-width space", () => {
    assert.equal(sanitizeSmsValue("Acme\u202eEMCA"), "AcmeEMCA");
    assert.equal(sanitizeSmsValue("Ac\u200bme"), "Acme");
  });

  it("neutralises our own control phrases so a feed cannot forge them", () => {
    assert.doesNotMatch(sanitizeSmsValue("SPOKES: pay now"), /SPOKES:/);
    assert.doesNotMatch(sanitizeSmsValue("Reply STOP to win"), /Reply STOP/i);
  });

  it("keeps look-alikes readable and drops what it cannot encode", () => {
    assert.equal(sanitizeSmsValue("Joe\u2019s Diner \u2014 Main St"), "Joe's Diner - Main St");
    assert.equal(sanitizeSmsValue("Acme \ud83d\ude80 Metals"), "Acme Metals");
  });

  it("keeps an emoji title out of a composed body entirely", () => {
    const body = buildHeardBackSms("Warehouse \ud83d\ude80 Associate");
    assert.doesNotMatch(body, /[^\u0000-\u007f]/, body);
    assert.match(body, /Warehouse Associate/);
  });
});

describe("redactLinks", () => {
  it("replaces a URL with [link] so the stored log carries no token", () => {
    assert.equal(
      redactLinks("SPOKES: see https://visionquest.onrender.com/c/abc123 now"),
      "SPOKES: see [link] now",
    );
    assert.equal(redactLinks("go to visionquest.onrender.com/x today"), "go to [link] today");
  });

  it("redacts a bare domain with no path — still a link a reader will follow", () => {
    assert.equal(redactLinks("go to visionquest.onrender.com today"), "go to [link] today");
  });

  it("leaves an ordinary sentence alone", () => {
    const plain = "SPOKES: Still working at Mountain Metals? Reply Y or N.";
    assert.equal(redactLinks(plain), plain);
  });
});
