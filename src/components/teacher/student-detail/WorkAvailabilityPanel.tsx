import {
  AVAILABILITY_DAYS,
  AVAILABILITY_SLOTS,
  type AvailabilitySlot,
  type TransportMode,
  type WorkProfile,
} from "@/lib/connect/work-profile-shared";

/**
 * Read-only instructor view of a student's work profile (Match & Connect Task
 * 2.2). The student owns and edits this from Settings or through Sage; staff
 * see it so they know which jobs are actually reachable before proposing one.
 *
 * Every unanswered field says "Not set yet" rather than rendering a blank or a
 * zero — the difference between "will work for $0" and "has not said" is the
 * whole point of the panel.
 */

const DAY_LABELS: Record<(typeof AVAILABILITY_DAYS)[number], string> = {
  monday: "Monday",
  tuesday: "Tuesday",
  wednesday: "Wednesday",
  thursday: "Thursday",
  friday: "Friday",
  saturday: "Saturday",
  sunday: "Sunday",
};

const SLOT_LABELS: Record<AvailabilitySlot, string> = {
  morning: "Morning",
  afternoon: "Afternoon",
  evening: "Evening",
  overnight: "Overnight",
};

const TRANSPORT_LABELS: Record<TransportMode, string> = {
  car: "Has a car",
  ride: "Someone drives them",
  bus: "Bus",
  walk: "Walks",
  none: "No ride yet",
};

const SOURCE_LABELS: Record<WorkProfile["updatedVia"], string> = {
  student: "the student",
  sage: "Sage",
  teacher: "staff",
};

const NOT_SET = "Not set yet";

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 py-1.5">
      <dt className="text-sm text-[var(--ink-muted)]">{label}</dt>
      <dd className="text-sm font-medium text-[var(--ink-strong)]">{value}</dd>
    </div>
  );
}

function availabilityLines(profile: WorkProfile): string[] {
  return AVAILABILITY_DAYS.flatMap((day) => {
    const open = AVAILABILITY_SLOTS.filter((slot) => profile.availability[day]?.[slot]);
    if (open.length === 0) return [];
    return [`${DAY_LABELS[day]}: ${open.map((slot) => SLOT_LABELS[slot]).join(", ")}`];
  });
}

export function WorkAvailabilityPanel({ workProfile }: { workProfile: WorkProfile | null }) {
  const days = workProfile ? availabilityLines(workProfile) : [];

  return (
    <section className="surface-section p-4" aria-labelledby="work-availability-heading">
      <h3
        id="work-availability-heading"
        className="font-display text-lg text-[var(--ink-strong)]"
      >
        Work availability
      </h3>

      {!workProfile ? (
        <p className="mt-2 text-sm text-[var(--ink-muted)]">
          {NOT_SET}. The student can fill this in under Settings, or Sage can ask them in chat.
        </p>
      ) : (
        <>
          <dl className="mt-2 divide-y divide-[var(--border)]">
            <Row
              label="Days and times they can work"
              value={
                days.length > 0 ? (
                  <ul className="list-none">
                    {days.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                ) : (
                  NOT_SET
                )
              }
            />
            <Row
              label="How they get to work"
              value={workProfile.transport ? TRANSPORT_LABELS[workProfile.transport] : NOT_SET}
            />
            <Row
              label="Lowest pay they can take"
              value={
                workProfile.payFloorHourly !== null
                  ? `$${workProfile.payFloorHourly} an hour`
                  : NOT_SET
              }
            />
            <Row label="Soonest they can start" value={workProfile.earliestStart ?? NOT_SET} />
            <Row label="Kids' hours" value={workProfile.childcareHours?.note ?? NOT_SET} />
            <Row label="ZIP code" value={workProfile.homeZip ?? NOT_SET} />
            <Row label="County" value={workProfile.county ?? NOT_SET} />
            <Row
              label="Longest drive they can make"
              value={
                workProfile.maxCommuteMinutes !== null
                  ? `${workProfile.maxCommuteMinutes} minutes`
                  : NOT_SET
              }
            />
          </dl>
          <p className="mt-3 text-xs text-[var(--ink-muted)]">
            Last saved by {SOURCE_LABELS[workProfile.updatedVia]} on{" "}
            {workProfile.updatedAt.slice(0, 10)}.
          </p>
        </>
      )}
    </section>
  );
}
