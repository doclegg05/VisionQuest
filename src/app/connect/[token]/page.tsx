import {
  EmployerResponseActions,
  type EmployerSlot,
} from "@/components/connect/EmployerResponseActions";
import { listInstructorSlots } from "@/lib/connect/employer-actions";
import {
  EMPLOYER_LINK_INACTIVE_MESSAGE,
  recordEmployerView,
  resolveEmployerLink,
} from "@/lib/connect/employer-link";
import { CONNECT_CONFIG_KEY } from "@/lib/connect/flags-shared";
import { EMPLOYER_FIELD_LABELS, SUBSIDY_FALLBACK_LINE } from "@/lib/connect/packet-shared";
import { getPlainConfigValue } from "@/lib/system-config";

/**
 * /connect/[token] — the employer's response page (Match & Connect Task 4.4).
 *
 * Public, in the same shape as /credentials/[slug]: a server component that
 * resolves an opaque identifier through `prismaAdmin` inside one bounded
 * helper, and renders a view model that contains no student id, no contact
 * id, and no score. There is no `<script>` here beyond the actions component
 * and no analytics of any kind.
 *
 * Every dead link — expired, already answered, unknown, or a class outside the
 * pilot — renders the SAME neutral page, so a stranger cannot learn from it
 * whether a real candidate sits behind a token they guessed.
 */
export const dynamic = "force-dynamic";
// One candidate's packet behind a capability URL — never cached by a proxy or
// a shared browser, and never indexed.
export const revalidate = 0;

function formatSlot(startsAt: string): string {
  return new Date(startsAt).toLocaleString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  });
}

export default async function EmployerConnectPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const view = await resolveEmployerLink(
    token,
    await getPlainConfigValue(CONNECT_CONFIG_KEY),
  );

  if (!view) {
    return (
      <main id="main-content" className="min-h-screen px-4 py-10">
        <div className="mx-auto max-w-xl">
          <div className="surface-section p-6">
            <h1 className="text-xl font-semibold text-[var(--ink-strong)]">
              {EMPLOYER_LINK_INACTIVE_MESSAGE}
            </h1>
            <p className="mt-3 text-base text-[var(--ink-muted)]">
              If you still want to talk to us, reply to the email you were sent.
            </p>
          </div>
        </div>
      </main>
    );
  }

  // Logged before the packet is drawn, and at most once an hour per token.
  await recordEmployerView(view.connectionId, view.status);

  const slots: EmployerSlot[] = view.advisorId
    ? (await listInstructorSlots(view.advisorId)).map((slot) => ({
        startsAt: slot.startsAt,
        label: formatSlot(slot.startsAt),
      }))
    : [];

  // The EMPLOYER's wording, not the student's. `packetFieldList` renders the
  // consent-screen labels ("Your résumé", "The cards you earned"), which read
  // as if this page were addressing the candidate — or worse, telling the
  // employer about their own résumé.
  const fields = view.packet.includedFields.map((key) => EMPLOYER_FIELD_LABELS[key]);
  // Gate every block on the APPROVED FIELD LIST, not on whether the value
  // happens to be present. A packet whose `includedFields` omits a key but
  // whose value column still carries something — a student who approved a
  // narrower list, or a future partial packet — must not have it rendered:
  // the list is what they consented to, and the value is just storage.
  const included = new Set(view.packet.includedFields);

  return (
    <main id="main-content" className="min-h-screen px-4 py-8 md:px-8">
      <div className="mx-auto flex max-w-2xl flex-col gap-6">
        <section className="page-hero">
          <p className="page-eyebrow">SPOKES</p>
          <p className="text-sm text-[var(--ink-muted)]">
            SPOKES is a West Virginia program that helps people train for jobs and get hired.
          </p>
          {/* The employer is named so a contact who handles hiring for more
              than one site knows immediately which opening this is about. */}
          <h1 className="page-title">
            {view.packet.candidateName} for your {view.jobTitle} job at {view.employerName}
          </h1>
          <p className="page-subtitle">
            {view.instructorName} sent you this. {view.packet.candidateName} said it was OK to
            share the things below.
          </p>
        </section>

        <section className="surface-section p-6">
          <h2 className="text-lg font-semibold text-[var(--ink-strong)]">About them</h2>
          <dl className="mt-4 flex flex-col gap-4">
            {included.has("verified_certifications") && view.packet.certifications.length > 0 && (
              <div>
                <dt className="text-sm font-semibold text-[var(--ink-muted)]">
                  Cards a teacher checked
                </dt>
                <dd className="mt-1 text-base text-[var(--ink-strong)]">
                  {view.packet.certifications.join(", ")}
                </dd>
              </div>
            )}
            {included.has("availability") &&
              view.packet.availabilitySummary &&
              view.packet.availabilitySummary !== "Not set" && (
              <div>
                <dt className="text-sm font-semibold text-[var(--ink-muted)]">When they can work</dt>
                <dd className="mt-1 text-base text-[var(--ink-strong)]">
                  {view.packet.availabilitySummary}
                </dd>
              </div>
            )}
            {included.has("earliest_start") && view.packet.earliestStart && (
              <div>
                <dt className="text-sm font-semibold text-[var(--ink-muted)]">
                  The soonest they can start
                </dt>
                <dd className="mt-1 text-base text-[var(--ink-strong)]">
                  {view.packet.earliestStart}
                </dd>
              </div>
            )}
            {included.has("endorsement") && view.packet.endorsement.trim().length > 0 && (
              <div>
                <dt className="text-sm font-semibold text-[var(--ink-muted)]">
                  What their teacher says
                </dt>
                <dd className="mt-1 text-base text-[var(--ink-strong)]">
                  {view.packet.endorsement}
                </dd>
              </div>
            )}
          </dl>

          {included.has("resume") && view.hasPacketPdf && (
            <a
              href={`/api/connect/employer/${token}/packet`}
              className="mt-5 inline-flex min-h-[44px] items-center justify-center rounded-lg border border-[var(--border)] px-4 py-2 text-base font-semibold text-[var(--ink-strong)]"
            >
              Open their résumé
            </a>
          )}

          <div className="mt-5 text-sm text-[var(--ink-muted)]">
            <p>This is everything that was shared:</p>
            <ul className="mt-1 list-disc pl-5">
              {fields.map((field) => (
                <li key={field}>{field}</li>
              ))}
            </ul>
          </div>
        </section>

        {/* Gated on the field like every other block.

            It used to print the fallback line even when `subsidy_line` was
            NOT in the approved list — harmless-looking, because the fallback
            says nothing about the student, but it broke the one rule this
            page has: what renders is what the student approved, and nothing
            else. A block that ignores `includedFields` "because its content
            is generic" is the precedent that lets the next one ignore it too.
            The student's own card applies the same rule, so the two surfaces
            agree by construction rather than by coincidence. */}
        {included.has("subsidy_line") && (
          <section className="surface-section p-6">
            <h2 className="text-lg font-semibold text-[var(--ink-strong)]">Money for hiring</h2>
            <p className="mt-2 text-base text-[var(--ink-strong)]">
              {view.packet.subsidyLine ?? SUBSIDY_FALLBACK_LINE}
            </p>
            <p className="mt-2 text-sm text-[var(--ink-muted)]">
              Rules change. Check with the local WV Works office before you count on any of it.
            </p>
          </section>
        )}

        <EmployerResponseActions token={token} slots={slots} />

        <p className="text-sm text-[var(--ink-muted)]">
          Questions? Reply to the email from {view.instructorName}.
        </p>
      </div>
    </main>
  );
}
