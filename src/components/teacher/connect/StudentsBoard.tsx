import Link from "next/link";

/**
 * The roster, each student with their best leads.
 *
 * Computed server-side by `rankRoster` — capped at three leads per student, so
 * this is a shortlist to act on rather than a ranking to read. The score is
 * deliberately not shown: an instructor needs to know WHY, and the reasons
 * carry that in plain words.
 */

export interface StudentsBoardItem {
  studentId: string;
  displayName: string;
  leads: Array<{ jobLeadId: string; title: string; employerName: string; reasons: string[] }>;
}

export function StudentsBoard({ students }: { students: StudentsBoardItem[] }) {
  if (students.length === 0) {
    return (
      <div className="theme-card rounded-xl p-5">
        <h2 className="text-base font-semibold text-[var(--ink-strong)]">Students</h2>
        <p className="mt-3 text-sm text-[var(--ink-muted)]">
          No active students in your classes yet.
        </p>
      </div>
    );
  }

  return (
    <section aria-labelledby="students-board-heading" className="theme-card rounded-xl p-5">
      <h2 id="students-board-heading" className="text-base font-semibold text-[var(--ink-strong)]">
        Students ({students.length})
      </h2>
      <ul className="mt-4 grid gap-3 md:grid-cols-2">
        {students.map((student) => (
          <li key={student.studentId} className="theme-card-subtle rounded-lg p-4">
            <Link
              href={`/teacher/students/${student.studentId}`}
              className="inline-flex min-h-[44px] items-center text-sm font-semibold text-[var(--ink-strong)] underline"
            >
              {student.displayName}
            </Link>

            {student.leads.length === 0 ? (
              <p className="mt-2 text-sm text-[var(--ink-muted)]">
                No lead fits them yet. Add a lead, or check their work answers.
              </p>
            ) : (
              <ol className="mt-2 space-y-2">
                {student.leads.map((lead) => (
                  <li key={lead.jobLeadId}>
                    <p className="text-sm text-[var(--ink-strong)]">
                      {lead.title} at {lead.employerName}
                    </p>
                    {lead.reasons.length > 0 && (
                      <p className="mt-0.5 text-sm text-[var(--ink-muted)]">
                        {lead.reasons.slice(0, 2).join(" ")}
                      </p>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
