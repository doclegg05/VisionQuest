import { type FormEvent } from "react";
import type {
  StudentData,
  AppointmentData,
  TaskData,
  NoteData,
  FormSubmissionData,
} from "./types";

const NOTE_CATEGORIES = [
  { value: "general", label: "General" },
  { value: "check_in", label: "Check-in" },
  { value: "risk", label: "Risk" },
  { value: "career", label: "Career" },
  { value: "celebration", label: "Celebration" },
] as const;

const TASK_PRIORITIES = ["low", "normal", "high"] as const;

type AppointmentStatusValue = "scheduled" | "completed" | "missed" | "cancelled";

function statusBadge(status: string): string {
  if (status === "completed") return "bg-emerald-100 text-emerald-700";
  if (status === "missed") return "bg-rose-100 text-rose-800";
  if (status === "cancelled") return "bg-[var(--surface-interactive)] text-[var(--ink-strong)]";
  return "bg-sky-100 text-sky-700";
}

interface AppointmentFormValues {
  title: string;
  description: string;
  startsAt: string;
  endsAt: string;
  locationType: string;
  locationLabel: string;
  meetingUrl: string;
  notes: string;
  followUpRequired: boolean;
}

interface TaskFormValues {
  title: string;
  description: string;
  dueAt: string;
  priority: string;
  appointmentId: string;
}

interface NoteFormValues {
  category: string;
  body: string;
}

interface OperationsTabProps {
  data: StudentData;
  dateFormatter: Intl.DateTimeFormat;
  /** Form review */
  reviewingFormId: string | null;
  onReviewForm: (submissionId: string, status: "approved" | "rejected") => void;
  /** Appointment form */
  appointmentForm: AppointmentFormValues;
  onAppointmentFormChange: (updater: (current: AppointmentFormValues) => AppointmentFormValues) => void;
  savingAppointment: boolean;
  onCreateAppointment: (event: FormEvent<HTMLFormElement>) => void;
  /** Appointment status */
  updatingAppointmentId: string | null;
  onAppointmentStatusChange: (appointmentId: string, status: AppointmentStatusValue) => void;
  /** Task form */
  taskForm: TaskFormValues;
  onTaskFormChange: (updater: (current: TaskFormValues) => TaskFormValues) => void;
  savingTask: boolean;
  onCreateTask: (event: FormEvent<HTMLFormElement>) => void;
  /** Task status */
  updatingTaskId: string | null;
  onTaskStatusChange: (taskId: string, status: "open" | "completed") => void;
  /** Note form */
  noteForm: NoteFormValues;
  onNoteFormChange: (updater: (current: NoteFormValues) => NoteFormValues) => void;
  savingNote: boolean;
  onCreateNote: (event: FormEvent<HTMLFormElement>) => void;
}

export default function OperationsTab({
  data,
  dateFormatter,
  reviewingFormId,
  onReviewForm,
  appointmentForm,
  onAppointmentFormChange,
  savingAppointment,
  onCreateAppointment,
  updatingAppointmentId,
  onAppointmentStatusChange,
  taskForm,
  onTaskFormChange,
  savingTask,
  onCreateTask,
  updatingTaskId,
  onTaskStatusChange,
  noteForm,
  onNoteFormChange,
  savingNote,
  onCreateNote,
}: OperationsTabProps) {
  const {
    formSubmissions,
    appointments,
    tasks,
    notes,
  } = data;

  return (
    <div className="space-y-6">
      {/* Submitted Forms */}
      <div id="submitted-forms" className="theme-card rounded-xl p-5">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h3 className="text-sm font-semibold text-[var(--ink-strong)]">Submitted Forms</h3>
            <p className="mt-1 text-sm text-[var(--ink-muted)]">
              Review uploaded paperwork and clear pending review items from the advising queue.
            </p>
          </div>
          <span className="rounded-full bg-[rgba(16,37,62,0.06)] px-3 py-1 text-xs font-semibold text-[var(--ink-muted)]">
            {formSubmissions.length} submission{formSubmissions.length === 1 ? "" : "s"}
          </span>
        </div>

        {formSubmissions.length === 0 ? (
          <p className="mt-4 text-sm text-[var(--ink-muted)]">No form submissions yet.</p>
        ) : (
          <div className="mt-4 space-y-3">
            {formSubmissions.map((submission: FormSubmissionData) => (
              <div key={submission.id} className="theme-card-subtle rounded-lg p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold text-[var(--ink-strong)]">{submission.title}</p>
                      <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                        submission.status === "approved"
                          ? "bg-emerald-100 text-emerald-700"
                          : submission.status === "rejected"
                            ? "bg-rose-100 text-rose-800"
                            : "bg-amber-100 text-amber-800"
                      }`}>
                        {submission.status}
                      </span>
                    </div>
                    {submission.description ? (
                      <p className="mt-2 text-sm text-[var(--ink-muted)]">{submission.description}</p>
                    ) : null}
                    <p className="mt-2 text-xs text-[var(--ink-muted)]">
                      Updated {dateFormatter.format(new Date(submission.updatedAt))}
                      {submission.reviewedAt ? ` \u2022 Reviewed ${dateFormatter.format(new Date(submission.reviewedAt))}` : ""}
                    </p>
                    {submission.notes ? (
                      <p className="mt-2 text-sm text-[var(--ink-muted)]">Note: {submission.notes}</p>
                    ) : null}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {submission.file ? (
                      <a
                        href={`/api/files/download?id=${submission.file.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="rounded-full border border-[rgba(18,38,63,0.12)] px-3 py-1.5 text-xs font-semibold text-[var(--ink-strong)] hover:bg-[var(--surface-raised)]"
                      >
                        Open file
                      </a>
                    ) : null}
                    {submission.signatureFile ? (
                      <a
                        href={`/api/files/download?id=${submission.signatureFile.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-100"
                      >
                        View signature
                      </a>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => onReviewForm(submission.id, "approved")}
                      disabled={reviewingFormId === submission.id}
                      className="rounded-full bg-emerald-100 px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-200 disabled:opacity-60"
                    >
                      {reviewingFormId === submission.id ? "Saving..." : "Approve"}
                    </button>
                    <button
                      type="button"
                      onClick={() => onReviewForm(submission.id, "rejected")}
                      disabled={reviewingFormId === submission.id}
                      className="rounded-full bg-rose-100 px-3 py-1.5 text-xs font-semibold text-rose-800 hover:bg-rose-200 disabled:opacity-60"
                    >
                      Return
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Appointments & Tasks Grid */}
      <div className="grid gap-6 xl:grid-cols-2">
        {/* Appointments */}
        <div className="theme-card rounded-xl p-5">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <h3 className="text-sm font-semibold text-[var(--ink-strong)]">Appointments</h3>
              <p className="mt-1 text-sm text-[var(--ink-muted)]">
                Schedule check-ins and update the outcome after each meeting.
              </p>
            </div>
          </div>

          <form onSubmit={onCreateAppointment} className="mt-4 space-y-3">
            <input
              type="text"
              value={appointmentForm.title}
              onChange={(event) => onAppointmentFormChange((current) => ({ ...current, title: event.target.value }))}
              placeholder="Appointment title"
              className="w-full theme-card-subtle rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <textarea
              value={appointmentForm.description}
              onChange={(event) => onAppointmentFormChange((current) => ({ ...current, description: event.target.value }))}
              placeholder="What is this session for?"
              rows={3}
              className="w-full theme-card-subtle rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-sm text-[var(--ink-muted)]">
                <span className="mb-1 block text-xs font-medium uppercase tracking-[0.12em] text-[var(--ink-muted)]">
                  Start
                </span>
                <input
                  type="datetime-local"
                  value={appointmentForm.startsAt}
                  onChange={(event) => onAppointmentFormChange((current) => ({ ...current, startsAt: event.target.value }))}
                  className="w-full theme-card-subtle rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </label>
              <label className="text-sm text-[var(--ink-muted)]">
                <span className="mb-1 block text-xs font-medium uppercase tracking-[0.12em] text-[var(--ink-muted)]">
                  End
                </span>
                <input
                  type="datetime-local"
                  value={appointmentForm.endsAt}
                  onChange={(event) => onAppointmentFormChange((current) => ({ ...current, endsAt: event.target.value }))}
                  className="w-full theme-card-subtle rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </label>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="text-sm text-[var(--ink-muted)]">
                <span className="mb-1 block text-xs font-medium uppercase tracking-[0.12em] text-[var(--ink-muted)]">
                  Format
                </span>
                <select
                  value={appointmentForm.locationType}
                  onChange={(event) => onAppointmentFormChange((current) => ({ ...current, locationType: event.target.value }))}
                  className="w-full theme-card-subtle rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="virtual">Virtual</option>
                  <option value="in_person">In person</option>
                  <option value="phone">Phone</option>
                </select>
              </label>
              <label className="text-sm text-[var(--ink-muted)] sm:col-span-2">
                <span className="mb-1 block text-xs font-medium uppercase tracking-[0.12em] text-[var(--ink-muted)]">
                  Location or label
                </span>
                <input
                  type="text"
                  value={appointmentForm.locationLabel}
                  onChange={(event) => onAppointmentFormChange((current) => ({ ...current, locationLabel: event.target.value }))}
                  placeholder="Zoom room, Office 201, Phone call"
                  className="w-full theme-card-subtle rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </label>
            </div>
            <input
              type="url"
              value={appointmentForm.meetingUrl}
              onChange={(event) => onAppointmentFormChange((current) => ({ ...current, meetingUrl: event.target.value }))}
              placeholder="Meeting URL (optional)"
              className="w-full theme-card-subtle rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <input
              type="text"
              value={appointmentForm.notes}
              onChange={(event) => onAppointmentFormChange((current) => ({ ...current, notes: event.target.value }))}
              placeholder="Student-facing note (optional)"
              className="w-full theme-card-subtle rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <label className="flex items-center gap-2 text-sm text-[var(--ink-muted)]">
              <input
                type="checkbox"
                checked={appointmentForm.followUpRequired}
                onChange={(event) => onAppointmentFormChange((current) => ({ ...current, followUpRequired: event.target.checked }))}
              />
              Follow-up will be required after this appointment
            </label>
            <button
              type="submit"
              disabled={savingAppointment}
              className="w-full rounded-full bg-[var(--ink-strong)] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[rgba(16,37,62,0.9)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {savingAppointment ? "Scheduling..." : "Schedule Appointment"}
            </button>
          </form>

          <div className="mt-5 space-y-3">
            {appointments.length === 0 ? (
              <p className="text-sm text-[var(--ink-muted)]">No appointments scheduled yet.</p>
            ) : (
              appointments.map((appointment: AppointmentData) => (
                <div key={appointment.id} className="theme-card-subtle rounded-lg p-4">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-semibold text-[var(--ink-strong)]">{appointment.title}</p>
                        <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${statusBadge(appointment.status)}`}>
                          {appointment.status}
                        </span>
                        {appointment.followUpRequired && (
                          <span className="rounded-full bg-violet-100 px-2.5 py-1 text-[11px] font-semibold text-violet-700">
                            follow-up
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-sm text-[var(--ink-muted)]">
                        {dateFormatter.format(new Date(appointment.startsAt))} {"\u2022"} {appointment.locationLabel || appointment.locationType.replace("_", " ")}
                      </p>
                      {appointment.description ? (
                        <p className="mt-2 text-sm text-[var(--ink-muted)]">{appointment.description}</p>
                      ) : null}
                    </div>

                    <div className="flex gap-2 flex-wrap">
                      {appointment.status === "scheduled" ? (
                        <>
                          <button
                            type="button"
                            onClick={() => onAppointmentStatusChange(appointment.id, "completed")}
                            disabled={updatingAppointmentId === appointment.id}
                            className="rounded-full bg-emerald-100 px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-200 disabled:opacity-60"
                          >
                            Complete
                          </button>
                          <button
                            type="button"
                            onClick={() => onAppointmentStatusChange(appointment.id, "missed")}
                            disabled={updatingAppointmentId === appointment.id}
                            className="rounded-full bg-rose-100 px-3 py-1.5 text-xs font-semibold text-rose-800 hover:bg-rose-200 disabled:opacity-60"
                          >
                            Missed
                          </button>
                          <button
                            type="button"
                            onClick={() => onAppointmentStatusChange(appointment.id, "cancelled")}
                            disabled={updatingAppointmentId === appointment.id}
                            className="rounded-full bg-[var(--surface-interactive)] px-3 py-1.5 text-xs font-semibold text-[var(--ink-strong)] hover:bg-[var(--surface-interactive-hover)] disabled:opacity-60"
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => onAppointmentStatusChange(appointment.id, "scheduled")}
                          disabled={updatingAppointmentId === appointment.id}
                          className="rounded-full bg-sky-100 px-3 py-1.5 text-xs font-semibold text-sky-700 hover:bg-sky-200 disabled:opacity-60"
                        >
                          Reopen
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-3 text-sm">
                    {appointment.meetingUrl ? (
                      <a
                        href={appointment.meetingUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:text-blue-800"
                      >
                        Open link
                      </a>
                    ) : null}
                    {appointment.notes ? <span className="text-[var(--ink-muted)]">Note: {appointment.notes}</span> : null}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Tasks */}
        <div className="theme-card rounded-xl p-5">
          <h3 className="text-sm font-semibold text-[var(--ink-strong)]">Follow-Up Tasks</h3>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">
            Assign next steps that the student can track and complete.
          </p>

          <form onSubmit={onCreateTask} className="mt-4 space-y-3">
            <input
              type="text"
              value={taskForm.title}
              onChange={(event) => onTaskFormChange((current) => ({ ...current, title: event.target.value }))}
              placeholder="Task title"
              className="w-full theme-card-subtle rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <textarea
              value={taskForm.description}
              onChange={(event) => onTaskFormChange((current) => ({ ...current, description: event.target.value }))}
              placeholder="What should the student do next?"
              rows={3}
              className="w-full theme-card-subtle rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="text-sm text-[var(--ink-muted)]">
                <span className="mb-1 block text-xs font-medium uppercase tracking-[0.12em] text-[var(--ink-muted)]">
                  Due
                </span>
                <input
                  type="datetime-local"
                  value={taskForm.dueAt}
                  onChange={(event) => onTaskFormChange((current) => ({ ...current, dueAt: event.target.value }))}
                  className="w-full theme-card-subtle rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </label>
              <label className="text-sm text-[var(--ink-muted)]">
                <span className="mb-1 block text-xs font-medium uppercase tracking-[0.12em] text-[var(--ink-muted)]">
                  Priority
                </span>
                <select
                  value={taskForm.priority}
                  onChange={(event) => onTaskFormChange((current) => ({ ...current, priority: event.target.value }))}
                  className="w-full theme-card-subtle rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {TASK_PRIORITIES.map((priority) => (
                    <option key={priority} value={priority}>
                      {priority}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm text-[var(--ink-muted)]">
                <span className="mb-1 block text-xs font-medium uppercase tracking-[0.12em] text-[var(--ink-muted)]">
                  Linked appointment
                </span>
                <select
                  value={taskForm.appointmentId}
                  onChange={(event) => onTaskFormChange((current) => ({ ...current, appointmentId: event.target.value }))}
                  className="w-full theme-card-subtle rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">None</option>
                  {appointments.map((appointment: AppointmentData) => (
                    <option key={appointment.id} value={appointment.id}>
                      {appointment.title}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <button
              type="submit"
              disabled={savingTask}
              className="w-full rounded-full bg-[var(--ink-strong)] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[rgba(16,37,62,0.9)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {savingTask ? "Saving..." : "Create Task"}
            </button>
          </form>

          <div className="mt-5 space-y-3">
            {tasks.length === 0 ? (
              <p className="text-sm text-[var(--ink-muted)]">No follow-up tasks yet.</p>
            ) : (
              tasks.map((task: TaskData) => (
                <div
                  key={task.id}
                  className={`rounded-lg border p-4 ${
                    task.status === "completed"
                      ? "border-emerald-200 bg-emerald-50/70"
                      : "border-[var(--border)] bg-[var(--surface-raised)]"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-semibold text-[var(--ink-strong)]">{task.title}</p>
                        <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                          task.priority === "high"
                            ? "bg-rose-100 text-rose-800"
                            : task.priority === "low"
                              ? "bg-[var(--surface-interactive)] text-[var(--ink-strong)]"
                              : "bg-amber-100 text-amber-800"
                        }`}>
                          {task.priority}
                        </span>
                      </div>
                      <p className="mt-1 text-sm text-[var(--ink-muted)]">
                        {task.dueAt ? `Due ${dateFormatter.format(new Date(task.dueAt))}` : "No due date"}
                      </p>
                      <p className="mt-1 text-xs uppercase tracking-[0.12em] text-[var(--ink-muted)]">
                        Created by {task.createdByName}
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() => onTaskStatusChange(task.id, task.status === "completed" ? "open" : "completed")}
                      disabled={updatingTaskId === task.id}
                      className={`rounded-full px-3 py-1.5 text-xs font-semibold disabled:opacity-60 ${
                        task.status === "completed"
                          ? "bg-[var(--surface-raised)] text-[var(--ink-strong)] hover:bg-[var(--surface-interactive)]"
                          : "bg-[var(--ink-strong)] text-white hover:bg-[rgba(16,37,62,0.9)]"
                      }`}
                    >
                      {updatingTaskId === task.id
                        ? "Saving..."
                        : task.status === "completed"
                          ? "Reopen"
                          : "Mark complete"}
                    </button>
                  </div>

                  {task.description ? (
                    <p className="mt-3 text-sm text-[var(--ink-muted)]">{task.description}</p>
                  ) : null}
                  {task.completedAt ? (
                    <p className="mt-2 text-xs text-emerald-700">
                      Completed {dateFormatter.format(new Date(task.completedAt))}
                    </p>
                  ) : null}
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Case Notes */}
      <div className="theme-card rounded-xl p-5">
        <h3 className="text-sm font-semibold text-[var(--ink-strong)]">Case Notes</h3>
        <p className="mt-1 text-sm text-[var(--ink-muted)]">
          Capture advising context, concerns, and wins for the teaching team.
        </p>

        <form onSubmit={onCreateNote} className="mt-4 grid gap-3 lg:grid-cols-[12rem_1fr_auto]">
          <select
            value={noteForm.category}
            onChange={(event) => onNoteFormChange((current) => ({ ...current, category: event.target.value }))}
            className="theme-card-subtle rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {NOTE_CATEGORIES.map((category) => (
              <option key={category.value} value={category.value}>
                {category.label}
              </option>
            ))}
          </select>
          <textarea
            value={noteForm.body}
            onChange={(event) => onNoteFormChange((current) => ({ ...current, body: event.target.value }))}
            placeholder="What happened, what matters, and what should happen next?"
            rows={3}
            className="theme-card-subtle rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            type="submit"
            disabled={savingNote}
            className="rounded-full bg-[var(--ink-strong)] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[rgba(16,37,62,0.9)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {savingNote ? "Saving..." : "Add Note"}
          </button>
        </form>

        <div className="mt-5 space-y-3">
          {notes.length === 0 ? (
            <p className="text-sm text-[var(--ink-muted)]">No case notes yet.</p>
          ) : (
            notes.map((note: NoteData) => (
              <div key={note.id} className="theme-card-subtle rounded-lg p-4">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="rounded-full bg-[var(--surface-interactive)] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--ink-strong)]">
                      {note.category.replace("_", " ")}
                    </span>
                    <span className="text-xs text-[var(--ink-muted)]">
                      {note.authorName} {"\u2022"} {dateFormatter.format(new Date(note.createdAt))}
                    </span>
                  </div>
                </div>
                <p className="mt-3 text-sm leading-6 text-[var(--ink-muted)]">{note.body}</p>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
