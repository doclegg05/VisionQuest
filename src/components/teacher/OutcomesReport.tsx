"use client";

import { useEffect, useState } from "react";

interface OutcomeSummary {
  totalStudents: number;
  activeStudents7d: number;
  studentsNeedingAttention: number;
  openAlerts: number;
  highSeverityAlerts: number;
  overdueTasks: number;
  openTasks: number;
  upcomingAppointments7d: number;
  activeOpportunities: number;
  closingSoonOpportunities: number;
  applicationsInFlight: number;
  interviews: number;
  offers: number;
  upcomingEvents: number;
  eventRegistrations: number;
  completedCertifications: number;
  publicCredentialsLive: number;
  studentsWithoutCareerMomentum: number;
}

interface FunnelItem {
  label: string;
  value: number;
}

interface AttentionStudent {
  id: string;
  studentId: string;
  displayName: string;
  openAlertCount: number;
  highSeverityAlertCount: number;
  topAlertTitle: string | null;
  lastActivityAt: string | null;
  daysSinceActivity: number | null;
  nextAppointmentAt: string | null;
  openTaskCount: number;
  overdueTaskCount: number;
  applicationsInFlight: number;
  eventRegistrationCount: number;
  completedCertification: boolean;
  publicCredentialLive: boolean;
}

interface RecentApplication {
  id: string;
  status: string;
  updatedAt: string;
  student: {
    id: string;
    studentId: string;
    displayName: string;
  };
  opportunity: {
    id: string;
    title: string;
    company: string;
  };
}

interface UpcomingEvent {
  id: string;
  title: string;
  startsAt: string;
  registrationCount: number;
}

interface ReportPayload {
  summary: OutcomeSummary;
  funnel: FunnelItem[];
  attentionQueue: AttentionStudent[];
  recentApplications: RecentApplication[];
  upcomingEvents: UpcomingEvent[];
}

const SUMMARY_CARDS: Array<{ key: keyof OutcomeSummary; label: string; tone: string }> = [
  { key: "studentsNeedingAttention", label: "Need attention", tone: "text-rose-800" },
  { key: "activeStudents7d", label: "Active this week", tone: "text-emerald-700" },
  { key: "applicationsInFlight", label: "Applications moving", tone: "text-sky-700" },
  { key: "offers", label: "Offers recorded", tone: "text-amber-800" },
  { key: "completedCertifications", label: "Certifications complete", tone: "text-violet-700" },
  { key: "publicCredentialsLive", label: "Public credentials live", tone: "text-teal-700" },
];

export default function OutcomesReport() {
  const [data, setData] = useState<ReportPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void loadData();
  }, []);

  async function loadData() {
    try {
      setLoading(true);
      const response = await fetch("/api/teacher/reports/outcomes");
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error || "Could not load reports.");
      }
      setData(payload);
      setError(null);
    } catch (err) {
      console.error("Failed to load outcome report:", err instanceof Error ? err.message : "Unknown error");
      setError(err instanceof Error ? err.message : "Could not load reports.");
    } finally {
      setLoading(false);
    }
  }

  if (loading) return <p className="text-sm text-[var(--ink-faint)]">Loading reports...</p>;

  if (error || !data) {
    return (
      <div className="text-center py-12">
        <p className="text-red-600 mb-4">{error || "Could not load reports."}</p>
        <button onClick={() => void loadData()} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
          Try Again
        </button>
      </div>
    );
  }

  const dateFormatter = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {SUMMARY_CARDS.map((card) => (
          <div key={card.key} className="theme-card rounded-xl p-4">
            <p className="text-xs uppercase tracking-[0.16em] text-[var(--ink-faint)]">{card.label}</p>
            <p className={`mt-2 text-3xl font-bold ${card.tone}`}>{data.summary[card.key]}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
        <div className="theme-card rounded-xl p-5">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <p className="text-xs uppercase tracking-[0.16em] text-[var(--ink-faint)]">Pipeline</p>
              <h3 className="mt-2 text-lg font-semibold text-[var(--ink-strong)]">Student outcome funnel</h3>
            </div>
            <span className="rounded-full bg-[var(--surface-interactive)] px-3 py-1 text-xs font-semibold text-[var(--ink-strong)]">
              {data.summary.totalStudents} learners
            </span>
          </div>

          <div className="mt-4 space-y-3">
            {data.funnel.map((item) => {
              const ratio = data.summary.totalStudents > 0 ? (item.value / data.summary.totalStudents) * 100 : 0;
              return (
                <div key={item.label}>
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="text-[var(--ink-muted)]">{item.label}</span>
                    <span className="font-semibold text-[var(--ink-strong)]">{item.value}</span>
                  </div>
                  <div className="mt-2 h-2 rounded-full bg-[var(--surface-interactive)]">
                    <div
                      className="h-full rounded-full bg-[linear-gradient(90deg,var(--accent-secondary),var(--accent-strong))]"
                      style={{ width: `${Math.min(100, Math.max(ratio, 6))}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="theme-card rounded-xl p-5">
          <p className="text-xs uppercase tracking-[0.16em] text-[var(--ink-faint)]">Operational snapshot</p>
          <h3 className="mt-2 text-lg font-semibold text-[var(--ink-strong)]">What needs follow-through</h3>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-amber-200 bg-amber-50/70 p-4">
              <p className="text-sm font-semibold text-amber-800">Open alerts</p>
              <p className="mt-2 text-2xl font-bold text-amber-900">{data.summary.openAlerts}</p>
              <p className="mt-1 text-xs text-amber-800">
                {data.summary.highSeverityAlerts} high-severity issues
              </p>
            </div>
            <div className="rounded-lg border border-rose-200 bg-rose-50/70 p-4">
              <p className="text-sm font-semibold text-rose-800">Overdue tasks</p>
              <p className="mt-2 text-2xl font-bold text-rose-900">{data.summary.overdueTasks}</p>
              <p className="mt-1 text-xs text-rose-800">
                {data.summary.openTasks} total open follow-ups
              </p>
            </div>
            <div className="rounded-lg border border-sky-200 bg-sky-50/80 p-4">
              <p className="text-sm font-semibold text-sky-800">Upcoming appointments</p>
              <p className="mt-2 text-2xl font-bold text-sky-900">{data.summary.upcomingAppointments7d}</p>
              <p className="mt-1 text-xs text-sky-800">Scheduled in the next 7 days</p>
            </div>
            <div className="rounded-lg border border-teal-200 bg-teal-50/80 p-4">
              <p className="text-sm font-semibold text-teal-800">Career momentum gaps</p>
              <p className="mt-2 text-2xl font-bold text-teal-900">{data.summary.studentsWithoutCareerMomentum}</p>
              <p className="mt-1 text-xs text-teal-800">
                Students without an event registration or active application
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <div className="theme-card rounded-xl p-5">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <p className="text-xs uppercase tracking-[0.16em] text-[var(--ink-faint)]">Outreach queue</p>
              <h3 className="mt-2 text-lg font-semibold text-[var(--ink-strong)]">Students who may need a touchpoint</h3>
            </div>
            <span className="rounded-full bg-[var(--surface-interactive)] px-3 py-1 text-xs font-semibold text-[var(--ink-strong)]">
              {data.attentionQueue.length} shown
            </span>
          </div>

          {data.attentionQueue.length === 0 ? (
            <p className="mt-4 text-sm text-[var(--ink-muted)]">Everyone is looking healthy right now.</p>
          ) : (
            <div className="mt-4 space-y-3">
              {data.attentionQueue.map((student) => (
                <a
                  key={student.id}
                  href={`/teacher/students/${student.id}`}
                  className="block theme-card-subtle rounded-lg p-4 transition-colors hover:border-[rgba(18,38,63,0.18)]"
                >
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div>
                      <p className="text-sm font-semibold text-[var(--ink-strong)]">{student.displayName}</p>
                      <p className="mt-1 text-xs uppercase tracking-[0.12em] text-[var(--ink-faint)]">
                        {student.studentId}
                      </p>
                    </div>
                    <div className="flex gap-2 flex-wrap">
                      {student.highSeverityAlertCount > 0 ? (
                        <span className="rounded-full bg-rose-100 px-2.5 py-1 text-xs font-semibold text-rose-800">
                          {student.highSeverityAlertCount} high
                        </span>
                      ) : null}
                      {student.openAlertCount > 0 ? (
                        <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-800">
                          {student.openAlertCount} alerts
                        </span>
                      ) : null}
                    </div>
                  </div>

                  <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                    <div>
                      <p className="text-xs uppercase tracking-[0.12em] text-[var(--ink-faint)]">Last activity</p>
                      <p className="mt-1 text-sm text-[var(--ink-strong)]">
                        {student.lastActivityAt ? `${student.daysSinceActivity}d ago` : "No activity yet"}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-[0.12em] text-[var(--ink-faint)]">Next appointment</p>
                      <p className="mt-1 text-sm text-[var(--ink-strong)]">
                        {student.nextAppointmentAt ? dateFormatter.format(new Date(student.nextAppointmentAt)) : "None"}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-[0.12em] text-[var(--ink-faint)]">Career actions</p>
                      <p className="mt-1 text-sm text-[var(--ink-strong)]">
                        {student.applicationsInFlight} apps • {student.eventRegistrationCount} events
                      </p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-[0.12em] text-[var(--ink-faint)]">Readiness</p>
                      <p className="mt-1 text-sm text-[var(--ink-strong)]">
                        {student.completedCertification ? "Certified" : "In progress"}
                        {student.publicCredentialLive ? " • Public" : ""}
                      </p>
                    </div>
                  </div>

                  {student.topAlertTitle ? (
                    <p className="mt-3 text-sm text-[var(--ink-muted)]">{student.topAlertTitle}</p>
                  ) : null}
                </a>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div className="theme-card rounded-xl p-5">
            <p className="text-xs uppercase tracking-[0.16em] text-[var(--ink-faint)]">Recent applications</p>
            <h3 className="mt-2 text-lg font-semibold text-[var(--ink-strong)]">Career pipeline movement</h3>

            {data.recentApplications.length === 0 ? (
              <p className="mt-4 text-sm text-[var(--ink-muted)]">No applications have moved into the active pipeline yet.</p>
            ) : (
              <div className="mt-4 space-y-3">
                {data.recentApplications.map((application) => (
                  <div key={application.id} className="theme-card-subtle rounded-lg p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-[var(--ink-strong)]">{application.opportunity.title}</p>
                        <p className="mt-1 text-sm text-[var(--ink-muted)]">
                          {application.student.displayName} • {application.opportunity.company}
                        </p>
                      </div>
                      <span className="rounded-full bg-sky-100 px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-sky-700">
                        {application.status}
                      </span>
                    </div>
                    <p className="mt-2 text-xs text-[var(--ink-faint)]">
                      Updated {dateFormatter.format(new Date(application.updatedAt))}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="theme-card rounded-xl p-5">
            <p className="text-xs uppercase tracking-[0.16em] text-[var(--ink-faint)]">Upcoming events</p>
            <h3 className="mt-2 text-lg font-semibold text-[var(--ink-strong)]">Who is showing up</h3>

            {data.upcomingEvents.length === 0 ? (
              <p className="mt-4 text-sm text-[var(--ink-muted)]">No upcoming events are currently scheduled.</p>
            ) : (
              <div className="mt-4 space-y-3">
                {data.upcomingEvents.map((event) => (
                  <div key={event.id} className="theme-card-subtle rounded-lg p-4">
                    <p className="text-sm font-semibold text-[var(--ink-strong)]">{event.title}</p>
                    <p className="mt-1 text-sm text-[var(--ink-muted)]">
                      {dateFormatter.format(new Date(event.startsAt))}
                    </p>
                    <p className="mt-2 text-xs text-[var(--ink-faint)]">
                      {event.registrationCount} registration{event.registrationCount === 1 ? "" : "s"}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
