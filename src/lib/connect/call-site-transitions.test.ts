import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  EMPLOYER_LINK_ACTIVE_STATUSES,
  canTransition,
  isConnectionStatus,
  type ConnectionStatus,
} from "./pipeline-shared";

/**
 * Every transition a call site can ATTEMPT must be legal from every status
 * that call site can OBSERVE.
 *
 * This exists because the two halves drifted apart silently. `recordInterested`
 * jumped `sent`/`viewed` straight to `interview_scheduled` and `recordHired`
 * jumped them to `hired`, and neither edge was in the table — so the employer's
 * answer threw after the Appointment had already been booked. Nothing failed at
 * build time and no unit test noticed, because `employer-actions.test.ts` was
 * mocking `./pipeline` wholesale and therefore never ran `canTransition` at all.
 *
 * So this test reads the SOURCE for `to:` literals rather than trusting a
 * hand-maintained list. A new call site, or a new `to:` on an old one, is
 * covered the moment it is written.
 */

interface CallSite {
  file: string;
  /** The statuses a row can be in when this file's transitions run. */
  observable: readonly ConnectionStatus[];
  /** Transitions this file performs that are not from `observable`. */
  ignore?: readonly ConnectionStatus[];
  /**
   * Per-TARGET narrowing, for a file whose transitions are each guarded to one
   * source status rather than sharing a set.
   *
   * `connections.ts` is the case this exists for: `approveConnection` passes
   * `expectedFrom: "proposed"` and `sendConnection` passes
   * `expectedFrom: "student_approved"`, so the flat cross-product would demand
   * edges the code can never attempt (sent -> sent), and either fail for a
   * reason that is not a bug or be silenced with a blanket ignore. Narrowing
   * per target keeps every remaining pair a real claim about the code.
   */
  observableFor?: Partial<Record<ConnectionStatus, readonly ConnectionStatus[]>>;
}

const CALL_SITES: CallSite[] = [
  {
    // The employer acts through a token, and `resolveEmployerLink` only ever
    // hands back a connection in one of these states — so these are exactly
    // the statuses employer-actions.ts can observe.
    file: "src/lib/connect/employer-actions.ts",
    // `interested`, `interview_scheduled` and `offered` are excluded from the
    // sweep and pinned individually below, because recordInterested guards
    // them explicitly rather than transitioning from them: an already-booked
    // employer is refused, and an already-`interested` one skips the claim.
    observable: EMPLOYER_LINK_ACTIVE_STATUSES.filter(
      (status) => status === "sent" || status === "viewed",
    ),
    // "interview_scheduled" follows the "interested" this same file just
    // wrote, not a status the link resolver produced.
    ignore: ["interview_scheduled"],
  },
  {
    // The staff and student side. Each of these transitions is guarded by an
    // explicit `expectedFrom` or a status check, so in practice the row is
    // narrower than this list — but the point of the scanner is to hold every
    // transition legal from every status the file could plausibly meet, so the
    // list is the whole non-terminal set rather than the one status each
    // function expects. A move that is illegal from any of them is a bug
    // waiting for the day the guard is loosened.
    file: "src/lib/connect/connections.ts",
    // Withdraw and close are the broad ones: a student may take back, and an
    // instructor may close, anything that has not ended. Post-hire statuses
    // are excluded from BOTH lists deliberately — `withdrawConnection` refuses
    // them (a hire is not a thing to take back on your own) and
    // STUDENT_ALLOWED_TRANSITIONS has no post-hire entries, so demanding those
    // edges here would ask the table to legalise exactly what the security fix
    // removed.
    observable: [
      "proposed",
      "student_approved",
      "sent",
      "viewed",
      "interested",
      "interview_scheduled",
      "offered",
    ],
    observableFor: {
      // approveConnection: expectedFrom "proposed".
      student_approved: ["proposed"],
      // sendConnection: expectedFrom "student_approved".
      sent: ["student_approved"],
    },
  },
];

function toLiterals(source: string): ConnectionStatus[] {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/[^\n]*$/gm, "");
  const found = new Set<string>();
  for (const match of code.matchAll(/\bto:\s*"([a-z_0-9]+)"/g)) found.add(match[1]);
  return [...found].filter(isConnectionStatus);
}

describe("every call site's transitions are legal from every status it can see", () => {
  for (const site of CALL_SITES) {
    const source = readFileSync(join(process.cwd(), site.file), "utf8");
    const targets = toLiterals(source);

    it(`${site.file} declares at least one transition (the scanner is not silently empty)`, () => {
      assert.ok(targets.length > 0, `no to: literals found in ${site.file}`);
    });

    for (const to of targets) {
      if (site.ignore?.includes(to)) continue;
      for (const from of site.observableFor?.[to] ?? site.observable) {
        it(`${site.file}: ${from} -> ${to} is in the table`, () => {
          assert.ok(
            canTransition(from, to),
            `${site.file} can attempt "${to}" while the connection is "${from}", ` +
              "but that edge is not legal — the call site would throw after its " +
              "side effect had already been written.",
          );
        });
      }
    }
  }

  it("the chained interview booking is legal from the status its own file just wrote", () => {
    // recordInterested writes `interested` first, then books. Pinned
    // separately because `interested` is not a status the link resolver hands
    // back — it is one this file creates.
    assert.ok(canTransition("interested", "interview_scheduled"));
  });

  it("the statuses recordInterested guards are exactly the ones with no legal claim", () => {
    // Each of these was a live throw-after-side-effect before the guards: an
    // employer returning to a link they had already answered.
    assert.equal(canTransition("interested", "interested"), false);
    assert.equal(canTransition("interview_scheduled", "interested"), false);
    assert.equal(canTransition("offered", "interested"), false);

    const source = readFileSync(
      join(process.cwd(), "src/lib/connect/employer-actions.ts"),
      "utf8",
    );
    // A refusal for the two booked states, and a skip for the resting one.
    assert.match(source, /currentStatus === "interview_scheduled" \|\| input\.currentStatus === "offered"/);
    assert.match(source, /currentStatus !== "interested"/);
  });

  it("the approve and send call sites match their single observable status", () => {
    // Both are guarded by an explicit status check before they transition, so
    // each has exactly one `from`.
    assert.ok(canTransition("proposed", "student_approved"));
    assert.ok(canTransition("student_approved", "sent"));
  });

  it("the scanner would notice an illegal edge", () => {
    // Proves the mechanism rather than trusting today's silence: `hired` is a
    // real status and `sent -> ... -> hired` is legal, but `hired -> viewed`
    // is not, and the scanner's own predicate is what says so.
    assert.equal(canTransition("hired", "viewed"), false);
    assert.deepEqual(toLiterals('await x({ to: "hired" }); await y({ to: "not_now" });'), [
      "hired",
      "not_now",
    ]);
    assert.deepEqual(toLiterals('{ to: "nonsense" }'), []);
  });
});
