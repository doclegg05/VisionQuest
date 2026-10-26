"use client";

import { useId, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { createTaskSchema, type TaskDetails } from "@/lib/dashboard/task-schemas";
import type { TaskDto } from "@/lib/dashboard/tasks";
import styles from "./dashboard.module.css";

interface TaskDialogProps {
  task?: TaskDto; open: boolean; onOpenChange: (open: boolean) => void; disabled: boolean;
  save: (values: TaskDetails, task?: TaskDto) => Promise<void>;
  remove?: (task: TaskDto) => Promise<void>;
}

// The form lives in the body, which Radix mounts only while open: every open starts from the task snapshot,
// and a refresh that changes the parent's data cannot reset a draft in progress.
export function TaskDialog({ open, onOpenChange, ...rest }: TaskDialogProps) {
  return <Dialog.Root open={open} onOpenChange={onOpenChange}>{open && <TaskDialogBody onOpenChange={onOpenChange} {...rest} />}</Dialog.Root>;
}

function TaskDialogBody({ task, onOpenChange, disabled, save, remove }: Omit<TaskDialogProps, "open">) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const id = useId();
  const form = useForm<z.input<typeof createTaskSchema>, unknown, TaskDetails>({
    resolver: zodResolver(createTaskSchema),
    defaultValues: { title: task?.title ?? "", description: task?.description ?? "", priority: (task?.priority as TaskDetails["priority"]) ?? "normal", dueAt: task?.dueAt?.slice(0, 10) ?? "" },
  });
  const pending = form.formState.isSubmitting || deleting;
  return <>
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-[100] bg-black/50" />
      <Dialog.Content className={`${styles.dialog} fixed left-1/2 top-1/2 z-[101] max-h-[90dvh] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl bg-[var(--surface-card)] p-6 text-[var(--ink-strong)] shadow-xl`} onEscapeKeyDown={(event) => { if (pending) event.preventDefault(); }} onPointerDownOutside={(event) => { if (pending) event.preventDefault(); }}>
        <Dialog.Title className="font-display text-xl font-semibold">{task ? "Edit personal task" : "Add a personal task"}</Dialog.Title>
        <Dialog.Description className="mt-2 text-sm text-[var(--ink-muted)]">Plan your next action. Completing a task does not sign off program requirements.</Dialog.Description>
        <form className="mt-5 space-y-4" onSubmit={form.handleSubmit(async (values) => {
          try { await save(values, task); onOpenChange(false); }
          catch (error) { form.setError("root", { message: error instanceof Error ? error.message : "Save failed. Try again." }); }
        })}>
          <fieldset disabled={pending} className="space-y-4">
            <div><label htmlFor={`${id}-title`}>Task title</label><input id={`${id}-title`} className="field mt-1 w-full p-3" maxLength={160} aria-invalid={!!form.formState.errors.title} aria-describedby={`${id}-title-error`} {...form.register("title")} /><p id={`${id}-title-error`} className="text-sm text-[var(--accent-red)]">{form.formState.errors.title?.message}</p></div>
            <div><label htmlFor={`${id}-description`}>Details (optional)</label><textarea id={`${id}-description`} className="field mt-1 w-full p-3" rows={3} maxLength={2000} aria-invalid={!!form.formState.errors.description} aria-describedby={`${id}-description-error`} {...form.register("description")} /><p id={`${id}-description-error`} className="text-sm text-[var(--accent-red)]">{form.formState.errors.description?.message}</p></div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2"><div><label htmlFor={`${id}-priority`}>Priority</label><select id={`${id}-priority`} className="field mt-1 w-full p-3" {...form.register("priority")}><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option></select></div>
            <div><label htmlFor={`${id}-due`}>Due date (optional)</label><input id={`${id}-due`} type="date" className="field mt-1 w-full p-3" aria-invalid={!!form.formState.errors.dueAt} aria-describedby={`${id}-due-error`} {...form.register("dueAt")} /><p id={`${id}-due-error`} className="text-sm text-[var(--accent-red)]">{form.formState.errors.dueAt?.message}</p></div></div>
          </fieldset>
          {form.formState.errors.root && <p role="alert" className="text-sm text-[var(--accent-red)]">{form.formState.errors.root.message}</p>}
          <div className="flex flex-wrap justify-end gap-3"><Dialog.Close asChild><button type="button" disabled={pending} className="secondary-button px-4 py-2">Cancel</button></Dialog.Close><button disabled={pending} className="primary-button px-4 py-2">{pending ? "Saving…" : "Save task"}</button></div>
        </form>
        {task && remove && <div className="mt-5 border-t border-[var(--border)] pt-4">
          {!confirmDelete ? <button disabled={pending} className="min-h-11 text-sm text-[var(--accent-red)]" onClick={() => setConfirmDelete(true)}>Delete personal task</button> : <><p className="text-sm">Delete this task permanently? This cannot be undone.</p><div className="mt-2 flex gap-4"><button disabled={pending || disabled} className="secondary-button px-3 py-2" onClick={async () => { setDeleting(true); try { await remove(task); onOpenChange(false); } catch (error) { form.setError("root", { message: error instanceof Error ? error.message : "Delete failed." }); } finally { setDeleting(false); } }}>Confirm delete</button><button className="secondary-button px-3 py-2" onClick={() => setConfirmDelete(false)}>Keep task</button></div></>}
        </div>}
      </Dialog.Content>
    </Dialog.Portal>
  </>;
}
