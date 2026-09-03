import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { intakePayloadSchema } from "@/lib/intake/schema";
import { provisionIntakeStudent } from "@/lib/intake/provision";
import { withErrorHandler } from "@/lib/api-error";
import { parseBody } from "@/lib/schemas";
import { rateLimit } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";

/**
 * POST /api/intake/submit — the public SPOKES intake form.
 *
 * Unauthenticated and account-creating, which fixes what it may hand back.
 * It issues NO session: it used to call `setSessionCookie` on whatever account
 * provisioning resolved, and provisioning resolved an existing account from a
 * name and a date of birth, so an anonymous POST naming a real person came
 * back holding their session cookie — a staff member's, if the email matched a
 * teacher row (review finding B1). A name and a birth date are facts about a
 * person, not proof of being them.
 *
 * It also returns NO credential and NO account detail. The reply is the same
 * whether the form described somebody brand new or somebody already enrolled,
 * so the endpoint cannot be used to ask "is this person in your program"
 * (M16/M17). Staff hand over sign-in details in person.
 */

/** Per-network bucket. Generous: a whole classroom may enroll at one address. */
const IP_LIMIT_ATTEMPTS = 15;
const IP_LIMIT_WINDOW_MS = 15 * 60 * 1000;

/**
 * Per-applicant bucket. `x-forwarded-for` is set by the client and only the
 * edge's own append is trustworthy, so the IP bucket above is a courtesy limit
 * that a determined caller rotates past (review finding M18). This second
 * bucket keys on the identity the form claims instead, which is the thing an
 * abusive submitter cannot vary without also changing which account they are
 * trying to create. Tight, because one person enrolls once.
 */
const PERSON_LIMIT_ATTEMPTS = 3;
const PERSON_LIMIT_WINDOW_MS = 60 * 60 * 1000;

const THROTTLED_MESSAGE =
  "Too many intake submissions right now. Please wait a few minutes, or ask your instructor to enroll you.";

/**
 * The same answer for every outcome — created, already enrolled, or held for
 * staff. Built fresh per request so no caller can mutate the shared object.
 */
function acknowledgement(): NextResponse {
  return NextResponse.json(
    {
      success: true,
      status: "received",
      message:
        "Your intake form was received. Your instructor will confirm your enrollment and give you your sign-in details.",
    },
    { status: 201 },
  );
}

/**
 * A Prisma error's `code` (P2002, P2003, …) without its `message`, which
 * quotes the failing query's arguments. Kept local to the two intake routes
 * rather than shared, because it is the boundary's own log hygiene.
 */
function describePrismaCode(error: unknown): string | null {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : null;
}

/**
 * A rate-limit bucket for the person the form describes, without putting their
 * name and date of birth in the `RateLimitEntry` table as plain text.
 */
function applicantKey(firstName: string, lastName: string, birthDate: string): string {
  const identity = `${firstName.trim().toLowerCase()}|${lastName.trim().toLowerCase()}|${birthDate.trim()}`;
  return createHash("sha256").update(identity).digest("hex").slice(0, 16);
}

export const POST = withErrorHandler(async (req: NextRequest) => {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const ipLimit = await rateLimit(`intake:submit:ip:${ip}`, IP_LIMIT_ATTEMPTS, IP_LIMIT_WINDOW_MS);
  if (!ipLimit.success) {
    return NextResponse.json({ error: THROTTLED_MESSAGE }, { status: 429 });
  }

  const payload = await parseBody(req, intakePayloadSchema);

  const personLimit = await rateLimit(
    `intake:submit:person:${applicantKey(payload.firstName, payload.lastName, payload.birthDate)}`,
    PERSON_LIMIT_ATTEMPTS,
    PERSON_LIMIT_WINDOW_MS,
  );
  if (!personLimit.success) {
    return NextResponse.json({ error: THROTTLED_MESSAGE }, { status: 429 });
  }

  try {
    await provisionIntakeStudent(payload, { source: "public" });
    return acknowledgement();
  } catch (error: unknown) {
    // The caller learns nothing about why. `error.message` used to travel back
    // in a `message` field, which handed anonymous callers Prisma's invocation
    // text — table names, constraint names, and the arguments of the failing
    // query, arguments being this applicant's own PII (review finding M4).
    //
    // The same text is why the log line carries the error's NAME and Prisma
    // code rather than its message: a Prisma invocation message quotes the
    // failing query's arguments, so logging it would move the applicant's name
    // and email straight into the server log (.claude/rules/security.md, Data
    // Privacy). Name plus code localizes the failure; the applicant does not
    // need to be in the line to do that.
    logger.error("Public intake submission failed", {
      alert: "intake_submit_error",
      errorName: error instanceof Error ? error.name : "unknown",
      code: describePrismaCode(error),
    });

    return NextResponse.json(
      {
        error:
          "We could not complete your enrollment at this moment. Please check with your instructor.",
      },
      { status: 500 },
    );
  }
});
