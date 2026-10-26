"use client";

import * as Dialog from "@radix-ui/react-dialog";
import type { TaskDto } from "@/lib/dashboard/tasks";
import { formatDueDate } from "./format-due-date";

const STATUS_LABELS: Record<string, string> = { open: "Open", in_progress: "In progress", completed: "Completed" };

export function TaskDetailsDialog({ task, open, onOpenChange }: { task: TaskDto; open: boolean; onOpenChange: (open: boolean) => void }) {
  return <Dialog.Root open={open} onOpenChange={onOpenChange}>
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-[100] bg-black/50" />
      <Dialog.Content className="fixed left-1/2 top-1/2 z-[101] max-h-[90dvh] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl bg-[var(--surface-card)] p-6 text-[var(--ink-strong)] shadow-xl">
        <Dialog.Title className="font-display text-xl font-semibold break-words">{task.title}</Dialog.Title>
        <Dialog.Description className="mt-2 text-sm text-[var(--ink-muted)]">Assigned by staff. Only staff can change these details.</Dialog.Description>
        <dl className="mt-5 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 text-sm">
          <dt className="font-semibold">Status</dt><dd>{STATUS_LABELS[task.status] ?? "Unknown status"}</dd>
          <dt className="font-semibold">Priority</dt><dd className="capitalize">{task.priority}</dd>
          <dt className="font-semibold">Due date</dt><dd>{formatDueDate(task.dueAt)}</dd>
        </dl>
        <p className="mt-4 whitespace-pre-wrap break-words text-sm">{task.description?.trim() ? task.description : "No extra instructions."}</p>
        <div className="mt-6 flex justify-end"><Dialog.Close asChild><button type="button" className="secondary-button min-h-11 px-4 py-2">Close</button></Dialog.Close></div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
