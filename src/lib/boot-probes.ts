import { AI_LOCAL_ONLY_ENV, isDemoLocalOnlyRequired } from "@/lib/ai/demo-local-only";
import { prismaAdmin } from "@/lib/db";
import { isCohortDemoEnabled, isRealStudentDataDeclared } from "@/lib/demo/config";
import { adminClientIsPrivileged } from "@/lib/nudges/admin-guard";
import { errorForLog } from "./log-error";
import { logger } from "./logger";

/**
 * Boot probes — the F63 shape, generalised (2026-09-06 hunt, follow-up 4).
 *
 * F63 named a class of bug, not one bug: a security control whose OFF state is
 * silent. Three live instances:
 *
 *  - `RLS_CONTEXT_INJECTION` is compared against the literal `"true"` inside
 *    the Prisma RLS extension (src/lib/db.ts). Anything else and the extension
 *    returns `query(args)` unwrapped, so no `app.current_user_id` GUC is ever
 *    set. Every policy that keys off the session then sees an empty context —
 *    and `assertStaffCanManageStudent`, which asks the database whether this
 *    staff member may touch this student, becomes a question nobody answers.
 *    No error is raised at any layer.
 *  - `ADMIN_DATABASE_URL` unset makes `prismaAdmin` fall back to `DATABASE_URL`
 *    (the restricted `vq_app` role), so cross-student reads return zero rows
 *    and writes are refused by policy. Every caller of it is written to be
 *    resilient, so the symptom is "nothing happened".
 *  - `JWT_SECRET` shorter than 32 characters weakens every session token in a
 *    way nothing at runtime will ever complain about.
 *
 * None of these three breaks a page. That is exactly why they need a probe:
 * the failure is invisible until an incident, and by then the question is how
 * long it had been that way.
 *
 * A probe returns `null` when the check passes and a short human sentence when
 * it fails. The sentence names the variable and never its value — these are
 * secrets and connection strings, and a boot log is not the place for either.
 */
export type BootProbeResult = string | null;

/** The `"true"` here is not a style choice — db.ts compares against it exactly. */
export function rlsContextInjectionProbe(): BootProbeResult {
  if (process.env.RLS_CONTEXT_INJECTION === "true") return null;
  return (
    "RLS_CONTEXT_INJECTION is not set to the exact string \"true\", so the Prisma RLS " +
    "extension runs every query with no session context. Row-level policies that key " +
    "off the actor — including the ones assertStaffCanManageStudent relies on — are " +
    "not enforced."
  );
}

export function adminDatabaseUrlProbe(): BootProbeResult {
  if ((process.env.ADMIN_DATABASE_URL ?? "").trim().length > 0) return null;
  return (
    "ADMIN_DATABASE_URL is not set, so prismaAdmin falls back to DATABASE_URL and runs " +
    "as the restricted vq_app role. Cross-student reads return zero rows and admin " +
    "writes are refused by policy, both silently."
  );
}

const MIN_JWT_SECRET_LENGTH = 32;

export function jwtSecretProbe(): BootProbeResult {
  const secret = process.env.JWT_SECRET ?? "";
  if (secret.length >= MIN_JWT_SECRET_LENGTH) return null;
  return `JWT_SECRET is missing or shorter than ${MIN_JWT_SECRET_LENGTH} characters.`;
}

/**
 * H2: cohort demo mode lets anyone with the link sign in with no password.
 * Once the owner has set REAL_STUDENT_DATA=true, real students with benefit
 * records are in the database, and demo mode would open them to that link.
 * The two can never be on together. Reads the environment only.
 */
export function demoAgainstRealDataProbe(): BootProbeResult {
  if (!isCohortDemoEnabled() || !isRealStudentDataDeclared()) return null;
  return (
    "COHORT_DEMO_MODE is on while REAL_STUDENT_DATA is \"true\". Demo mode lets anyone " +
    "with the link sign in without a password, so real student records would be open. " +
    "Turn COHORT_DEMO_MODE off. Unset REAL_STUDENT_DATA only if no real student has an account."
  );
}

/** The variable that allows cloud AI, and the one value that does it. */
export const AI_CLOUD_INFERENCE_ENV = "AI_CLOUD_INFERENCE";
export const AI_CLOUD_INFERENCE_ALLOWED = "allowed";

const LOCAL_ONLY_SWITCH_NAMES =
  `${AI_LOCAL_ONLY_ENV}, COHORT_DEMO_LOCAL_ONLY, COHORT_DEMO_MODE or VQ_MAC_RELAY_ENABLED`;

/**
 * H4: the block on cloud AI is a stated choice, never the absence of one.
 *
 * The owner's standing decision is that no student data goes to a cloud model.
 * The block (src/lib/ai/demo-local-only.ts) used to rest on switches named for
 * the demo and the relay. Delete those when the demo closes, or recreate the
 * service from the blueprint, and cloud AI came back with no error: the F63
 * shape again. So the deployment must say which it is, and say it once:
 *
 *  - local only: a switch that `isDemoLocalOnlyRequired()` reads is on, or
 *  - cloud allowed on purpose: AI_CLOUD_INFERENCE is exactly "allowed".
 *
 * Neither is a failure. Both is a failure too: the switch wins at run time,
 * but an "allowed" left beside it would open cloud AI the day the switch is
 * removed. A value this check does not recognize fails in every case, so a
 * misspelling is never read as an answer.
 *
 * AI_CLOUD_INFERENCE is its own variable, not AI_CLOUD_POLICY, on purpose.
 * AI_CLOUD_POLICY (src/lib/ai/lanes.ts) reads unset or misspelled as
 * `permissive`, a SystemConfig row can override it, and a check that reads the
 * environment only cannot see that row. It also answers a narrower question:
 * which prompts may reach a cloud model once one is in use.
 *
 * Reads the environment only. Nothing at run time reads AI_CLOUD_INFERENCE:
 * this check adds a refusal to start and changes no routing.
 */
export function cloudAiChoiceProbe(): BootProbeResult {
  const plainSwitch = (process.env[AI_LOCAL_ONLY_ENV] ?? "").trim().toLowerCase();
  if (plainSwitch !== "" && plainSwitch !== "true" && plainSwitch !== "false") {
    return (
      `${AI_LOCAL_ONLY_ENV} is set to a value this check does not recognize. ` +
      "Set it to \"true\" to keep every prompt on the local model, or remove it."
    );
  }

  const cloud = process.env[AI_CLOUD_INFERENCE_ENV] ?? "";
  if (cloud.trim() !== "" && cloud !== AI_CLOUD_INFERENCE_ALLOWED) {
    return (
      `${AI_CLOUD_INFERENCE_ENV} is set to a value this check does not recognize. The only ` +
      `accepted value is exactly "${AI_CLOUD_INFERENCE_ALLOWED}", with no spaces or capitals. ` +
      `To keep cloud AI blocked, remove it and set ${AI_LOCAL_ONLY_ENV} to "true".`
    );
  }

  const localOnly = isDemoLocalOnlyRequired();
  const cloudAllowed = cloud === AI_CLOUD_INFERENCE_ALLOWED;
  if (localOnly && cloudAllowed) {
    return (
      `${AI_CLOUD_INFERENCE_ENV} is "${AI_CLOUD_INFERENCE_ALLOWED}" while a local only switch is on ` +
      `(${LOCAL_ONLY_SWITCH_NAMES}). The switch wins and cloud AI stays blocked, but cloud AI ` +
      `would open with no error the day that switch is removed. Remove ${AI_CLOUD_INFERENCE_ENV}, ` +
      "or turn every local only switch off."
    );
  }
  if (!localOnly && !cloudAllowed) {
    return (
      "Nothing says whether this deployment may send prompts to a cloud AI model. Set " +
      `${AI_LOCAL_ONLY_ENV} to "true" to keep every prompt on the local model. Cloud AI needs a ` +
      `written owner decision first, and then ${AI_CLOUD_INFERENCE_ENV} set to exactly ` +
      `"${AI_CLOUD_INFERENCE_ALLOWED}".`
    );
  }
  return null;
}

/** Every check that can be decided from configuration alone, in boot order. */
const CONFIG_PROBES: ReadonlyArray<{ name: string; run: () => BootProbeResult }> = [
  { name: "RLS_CONTEXT_INJECTION", run: rlsContextInjectionProbe },
  { name: "ADMIN_DATABASE_URL", run: adminDatabaseUrlProbe },
  { name: "JWT_SECRET", run: jwtSecretProbe },
  { name: "COHORT_DEMO_MODE+REAL_STUDENT_DATA", run: demoAgainstRealDataProbe },
  { name: `${AI_LOCAL_ONLY_ENV}/${AI_CLOUD_INFERENCE_ENV}`, run: cloudAiChoiceProbe },
];

/**
 * The one probe that asks the database rather than the environment, reusing the
 * nudge feature's existing check rather than writing a second one: is the
 * connection `prismaAdmin` actually holds RLS-bypassing? A correctly-shaped
 * ADMIN_DATABASE_URL pointing at `vq_app` passes `adminDatabaseUrlProbe` and
 * fails this one.
 *
 * Deliberately NOT boot-fatal, and deliberately not awaited:
 *
 *  - `adminClientIsPrivileged()` returns false both for "this role cannot
 *    bypass RLS" and for "the database did not answer just now". A fatal probe
 *    that cannot tell those apart turns a transient blip during a deploy into a
 *    container that refuses to start and then restarts into the same failure.
 *  - Awaiting a database round trip inside `register()` puts it on the boot
 *    path for every cold start.
 *
 * It logs `boot_probe_admin_client_unprivileged`, on top of the alarm
 * admin-guard raises itself, so the alert exists at boot rather than at the
 * first hourly nudge sweep.
 */
function startAdminClientProbe(): void {
  void (async () => {
    try {
      if (await adminClientIsPrivileged()) return;
      logger.error("boot_probe_admin_client_unprivileged", {
        reason:
          "prismaAdmin is not RLS-bypassing. Either ADMIN_DATABASE_URL points at vq_app, " +
          "or the database did not answer the probe.",
      });
    } catch (error) {
      logger.error("boot_probe_admin_client_failed", { error: errorForLog(error) });
    }
  })();
}

const DEMO_ROWS = { demoAccount: { not: null } } as const;
const UNMARKED_STUDENTS = { role: "student", demoAccount: null } as const;

/**
 * H2's database half: does the data match the two switches? Alarms only, with
 * counts and never a name or id. It must never stop a start: the live demo
 * database holds mock students that may not all carry the `demoAccount` mark,
 * so a fatal version would take the demo down at the next deploy. Only the
 * environment (`demoAgainstRealDataProbe`) may stop the boot. A failed query
 * is logged and nothing else happens.
 */
export async function demoDataSeparationProbe(): Promise<void> {
  try {
    const demoOn = isCohortDemoEnabled();
    const realOn = isRealStudentDataDeclared();
    const demoAccounts = await prismaAdmin.student.count({ where: DEMO_ROWS });

    if (!demoOn && demoAccounts > 0) {
      logger.error("boot_probe_demo_closeout_unfinished", {
        demoAccounts,
        reason: "Demo mode is off but demo accounts remain. Finish the demo closeout: delete them.",
      });
    }
    if (realOn && demoAccounts > 0) {
      logger.error("boot_probe_demo_rows_beside_real_data", {
        demoAccounts,
        reason: "REAL_STUDENT_DATA is on but demo accounts remain beside real ones.",
      });
    }
    if (demoOn) {
      const unmarkedStudents = await prismaAdmin.student.count({ where: UNMARKED_STUDENTS });
      if (unmarkedStudents > 0) {
        logger.error("boot_probe_demo_open_with_unmarked_students", {
          unmarkedStudents,
          reason: "Demo mode is open while student accounts without the demo mark exist.",
        });
      }
    }
  } catch (error) {
    logger.error("boot_probe_demo_data_failed", { error: errorForLog(error) });
  }
}

/**
 * Runs every probe once. In production a failed CONFIG probe throws, which
 * propagates out of `register()` and stops the boot — a misconfigured instance
 * must not take traffic while quietly enforcing nothing. Everywhere else each
 * failure is one `logger.error` line, because a dev box legitimately runs
 * without an admin URL.
 *
 * `probes` is injectable for the test only; production always uses the list
 * above.
 */
export async function runBootProbes(
  probes: ReadonlyArray<{ name: string; run: () => BootProbeResult }> = CONFIG_PROBES,
): Promise<void> {
  const failures: { name: string; detail: string }[] = [];
  for (const probe of probes) {
    const detail = probe.run();
    if (detail !== null) failures.push({ name: probe.name, detail });
  }

  startAdminClientProbe();
  // Not awaited, for the same reasons as the admin-client probe; it never throws.
  void demoDataSeparationProbe();

  if (failures.length === 0) return;

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      `Boot probe failure (${failures.length}): ` +
        failures.map((f) => `${f.name} — ${f.detail}`).join(" | "),
    );
  }

  for (const failure of failures) {
    logger.error("boot_probe_failed", { probe: failure.name, detail: failure.detail });
  }
}
