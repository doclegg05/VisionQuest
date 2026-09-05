/**
 * "Shared with employers" — the student's own record of every packet that
 * left the program about them (Match & Connect Task 4.1).
 *
 * A server component: the list is student-own data the page already has a
 * session for, and there is nothing interactive here. It shows the employer,
 * the date, and the exact field list frozen in the packet at approval — not a
 * re-derived list, so what is displayed is what was actually sent.
 *
 * Deliberately shown even when empty: "nothing has been shared" is the answer
 * a student came to this page for, and an absent section reads as an absent
 * answer.
 */
export interface SharedPacket {
  id: string;
  employerName: string;
  jobTitle: string;
  sentOn: string | null;
  fields: string[];
  status: string;
}

export function SharedWithEmployers({ packets }: { packets: SharedPacket[] }) {
  return (
    <section className="surface-section mb-6 p-6" aria-labelledby="shared-with-employers">
      <h2 id="shared-with-employers" className="page-eyebrow text-[var(--ink-muted)]">
        Shared with employers
      </h2>

      {packets.length === 0 ? (
        <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--ink-muted)]">
          Nothing about you has been sent to an employer. If that changes, your teacher will ask
          you first, and it will show up here.
        </p>
      ) : (
        <>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--ink-muted)]">
            You said OK to each of these. Here is what was sent and when.
          </p>
          <ul className="mt-4 flex flex-col gap-4">
            {packets.map((packet) => (
              <li key={packet.id} className="rounded-lg border border-[var(--border)] p-4">
                <p className="text-base font-semibold text-[var(--ink-strong)]">
                  {packet.employerName} — {packet.jobTitle}
                </p>
                <p className="mt-1 text-sm text-[var(--ink-muted)]">
                  {packet.sentOn ? `Sent ${packet.sentOn}.` : "Not sent yet."} {packet.status}
                </p>
                <p className="mt-2 text-sm font-semibold text-[var(--ink-strong)]">
                  What they got:
                </p>
                <ul className="mt-1 flex flex-col gap-1">
                  {packet.fields.map((field) => (
                    <li key={field} className="text-sm text-[var(--ink-muted)]">
                      • {field}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
