import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { diffCronRegistrations, findRegisteredCronJobNames, run } from "./scheduled-layer-drift.mjs";
import { EXPECTED_CRON_JOBS } from "../../lib/cron-health.mjs";

test("diffCronRegistrations: no drift when the sets match exactly", () => {
  const expected = ["a", "b", "c"];
  const registered = ["a", "b", "c"];
  assert.deepEqual(diffCronRegistrations(expected, registered), {
    unregisteredExpected: [],
    unexpectedRegistered: [],
  });
});

test("diffCronRegistrations: a name a migration stops registering is unregisteredExpected", () => {
  const { unregisteredExpected, unexpectedRegistered } = diffCronRegistrations(["a", "b"], ["a"]);
  assert.deepEqual(unregisteredExpected, ["b"]);
  assert.deepEqual(unexpectedRegistered, []);
});

test("diffCronRegistrations: a job the health check does not expect is unexpectedRegistered — the connect-nudges class of drift", () => {
  const { unregisteredExpected, unexpectedRegistered } = diffCronRegistrations(
    ["a", "b"],
    ["a", "b", "connect-nudges"]
  );
  assert.deepEqual(unregisteredExpected, []);
  assert.deepEqual(unexpectedRegistered, ["connect-nudges"]);
});

test("findRegisteredCronJobNames: parses cron.schedule('<name>' across a multi-line PERFORM block, only in *cron*-named dirs, and skips a *cron* dir with no migration.sql", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "bench-cron-drift-"));
  try {
    const cronDir = path.join(dir, "20260101000000_add_something_cron");
    mkdirSync(cronDir, { recursive: true });
    writeFileSync(
      path.join(cronDir, "migration.sql"),
      `DO $$\nBEGIN\n  PERFORM cron.schedule(\n    'a-new-job',\n    '*/5 * * * *',\n    $sql$ select 1; $sql$\n  );\nEND $$;\n`
    );

    const notCronDir = path.join(dir, "20260102000000_add_unrelated_table");
    mkdirSync(notCronDir, { recursive: true });
    writeFileSync(path.join(notCronDir, "migration.sql"), `-- would register 'should-not-be-seen' if scanned\n`);

    const emptyCronDir = path.join(dir, "20260103000000_cron_placeholder");
    mkdirSync(emptyCronDir, { recursive: true }); // *cron*-named but no migration.sql — must not throw

    const { names, dirsScanned } = findRegisteredCronJobNames(dir);
    assert.deepEqual(names, ["a-new-job"]);
    assert.deepEqual(
      dirsScanned.sort(),
      ["20260101000000_add_something_cron", "20260103000000_cron_placeholder"].sort()
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("run(): against this repo's real migrations, every EXPECTED_CRON_JOBS name is registered somewhere in a *cron* migration", async () => {
  // This is the suite's actual job: red-baseline proof that the instrument
  // works, run against the real repo rather than a synthetic fixture. As of
  // this session it also demonstrates the suite catching real drift: PR
  // #204's connect-nudges cron job is registered but is not yet in
  // EXPECTED_CRON_JOBS, so unexpected_registered_jobs is expected to be >= 1
  // here rather than 0 — see this agent's final report, not a bug in this test.
  const result = await run({ fixture: {} });
  const unregistered = result.metrics.find((m) => m.id === "unregistered_expected_jobs");
  assert.equal(unregistered.value, 0, `expected every one of ${EXPECTED_CRON_JOBS.length} EXPECTED_CRON_JOBS to be registered`);
});
