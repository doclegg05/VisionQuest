"use client";

import { useState } from "react";
import { flexRender, getCoreRowModel, useReactTable, type ColumnDef, type RowSelectionState, type VisibilityState } from "@tanstack/react-table";
import type { TaskDto, TaskPage } from "@/lib/dashboard/tasks";
import type { TaskDetails, TaskQuery } from "@/lib/dashboard/task-schemas";
import { TaskDialog } from "./TaskDialog";
import { TaskDetailsDialog } from "./TaskDetailsDialog";
import { formatDueDate } from "./format-due-date";

interface TaskActions {
  pending: boolean;
  save: (values: TaskDetails, task?: TaskDto, version?: string) => Promise<void>;
  remove: (task: TaskDto) => Promise<void>;
  setStatus: (tasks: TaskDto[], status: string) => void;
}
type DialogMode = "edit" | "view";
interface TableMeta extends TaskActions { open: (task: TaskDto, mode: DialogMode) => void }
// Stable cell component identities keep open forms mounted across query/mutation updates.
const columns: ColumnDef<TaskDto>[] = [
    { id: "select", enableHiding: false, header: ({ table }) => <input type="checkbox" className="h-5 w-5" aria-label="Select tasks on this page" disabled={(table.options.meta as TableMeta).pending || !table.getRowModel().rows.length} checked={table.getIsAllPageRowsSelected()} onChange={table.getToggleAllPageRowsSelectedHandler()} />, cell: ({ row, table }) => <input type="checkbox" className="h-5 w-5" aria-label={`Select ${row.original.title}`} checked={row.getIsSelected()} disabled={(table.options.meta as TableMeta).pending} onChange={row.getToggleSelectedHandler()} /> },
    { accessorKey: "title", header: "Task", enableHiding: false, cell: ({ row }) => <div className="min-w-40 max-w-sm whitespace-normal break-words"><p className="font-semibold">{row.original.title}</p><p className="mt-1 text-xs text-[var(--ink-muted)]">{row.original.personal ? "Personal task" : "Assigned by staff"}</p></div> },
    { accessorKey: "status", header: "Status", cell: ({ row, table }) => <select className="field min-h-11 px-2 text-sm" aria-label={`Status for ${row.original.title}`} value={row.original.status} disabled={(table.options.meta as TableMeta).pending} onChange={(e) => (table.options.meta as TableMeta).setStatus([row.original], e.target.value)}><option value="open">Open</option><option value="in_progress">In progress</option><option value="completed">Completed</option>{!["open", "in_progress", "completed"].includes(row.original.status) && <option value={row.original.status}>Unknown status</option>}</select> },
    { accessorKey: "priority", header: "Priority", cell: ({ row }) => <span className="capitalize">{row.original.priority}</span> },
    { accessorKey: "dueAt", header: "Due date", cell: ({ row }) => <span suppressHydrationWarning>{formatDueDate(row.original.dueAt)}</span> },
    { id: "actions", header: "Details", enableHiding: false, cell: ({ row, table }) => { const task = row.original; const edit = task.personal; return <button className="secondary-button min-h-11 px-3 py-2" disabled={edit && (table.options.meta as TableMeta).pending} onClick={() => (table.options.meta as TableMeta).open(task, edit ? "edit" : "view")}>{edit ? "Edit" : "View details"}<span className="sr-only">{` ${task.title}`}</span></button>; } },
  ];

export function TaskTable({ data, query, setQuery, pending, save, remove, setStatus }: TaskActions & {
  data?: TaskPage; query: TaskQuery; setQuery: (query: TaskQuery) => void;
}) {
  const [selection, setSelection] = useState<RowSelectionState>({});
  const [visibility, setVisibility] = useState<VisibilityState>({});
  // Snapshot of the task being edited or read: it survives a refresh that drops the row from `data`.
  const [active, setActive] = useState<{ task: TaskDto; mode: DialogMode } | null>(null);
  const [adding, setAdding] = useState(false);
  const changeQuery = (patch: Partial<TaskQuery>) => { setSelection({}); setQuery({ ...query, page: 1, ...patch }); };
  // TanStack Table intentionally exposes a mutable table instance.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({ data: data?.tasks ?? [], columns, getCoreRowModel: getCoreRowModel(), getRowId: (row) => row.id,
    manualPagination: true, manualSorting: true, manualFiltering: true, rowCount: data?.total,
    meta: { pending, save, remove, setStatus, open: (task, mode) => setActive({ task, mode }) } satisfies TableMeta,
    state: { rowSelection: selection, columnVisibility: visibility }, onRowSelectionChange: setSelection, onColumnVisibilityChange: setVisibility,
  });
  const selected = table.getSelectedRowModel().rows.map((row) => row.original);
  const pages = data ? Math.max(1, Math.ceil(data.total / query.pageSize)) : null;
  return <>
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 id="tasks-heading" className="font-display text-xl font-semibold">My tasks</h2><button className="primary-button min-h-11 px-4 py-2" disabled={pending} onClick={() => setAdding(true)}>Add personal task</button></div>
    <p className="mt-2 text-sm text-[var(--ink-muted)]">Your own tasks and tasks from staff are in one list. Only staff can change the tasks they give you.</p>
    <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <label className="text-sm">Search tasks<input className="field mt-1 min-h-11 w-full px-3" type="search" maxLength={160} value={query.search} onChange={(e) => changeQuery({ search: e.target.value })} /></label>
      <label className="text-sm">Status<select className="field mt-1 min-h-11 w-full px-3" value={query.status} onChange={(e) => changeQuery({ status: e.target.value as TaskQuery["status"] })}><option value="all">All statuses</option><option value="open">Open</option><option value="in_progress">In progress</option><option value="completed">Completed</option></select></label>
      <label className="text-sm">Priority<select className="field mt-1 min-h-11 w-full px-3" value={query.priority} onChange={(e) => changeQuery({ priority: e.target.value as TaskQuery["priority"] })}><option value="all">All priorities</option><option value="high">High</option><option value="normal">Normal</option><option value="low">Low</option></select></label>
      <label className="text-sm">Sort by<select className="field mt-1 min-h-11 w-full px-3" value={`${query.sort}:${query.direction}`} onChange={(e) => { const [sort, direction] = e.target.value.split(":"); changeQuery({ sort: sort as TaskQuery["sort"], direction: direction as TaskQuery["direction"] }); }}><option value="dueAt:asc">Due date · earliest first</option><option value="createdAt:desc">Newest first</option><option value="title:asc">Title · A to Z</option><option value="title:desc">Title · Z to A</option><option value="status:asc">Status · A to Z</option><option value="priority:asc">Priority · A to Z</option></select></label>
    </div>
    <div className="my-4 flex flex-wrap items-start justify-between gap-3"><details><summary className="cursor-pointer py-2 text-sm">Show columns</summary><div className="flex flex-wrap gap-4 py-2">{table.getAllLeafColumns().filter((c) => c.getCanHide()).map((column) => <label key={column.id} className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={column.getIsVisible()} onChange={column.getToggleVisibilityHandler()} />{column.columnDef.header as string}</label>)}</div></details>
      <div className="flex flex-wrap items-center gap-3"><span className="text-sm" aria-live="polite">{selected.length} selected on this page</span><button className="secondary-button min-h-11 px-3 py-2 text-sm" disabled={pending || !selected.length} onClick={() => { setStatus(selected, "completed"); setSelection({}); }}>Complete selected</button><button className="secondary-button min-h-11 px-3 py-2 text-sm" disabled={pending || !selected.length} onClick={() => { setStatus(selected, "open"); setSelection({}); }}>Reopen selected</button></div>
    </div>
    {data && (data.tasks.length ? <div className="max-w-full overflow-x-auto rounded-xl border border-[var(--border)]" role="region" aria-label="Task table, scroll horizontally for more columns" tabIndex={0}><table className="w-full text-left text-sm"><caption className="sr-only">Your tasks, page {data.page}. Selection affects only this page.</caption><thead className="bg-[var(--surface-soft)]">{table.getHeaderGroups().map((group) => <tr key={group.id}>{group.headers.map((header) => <th scope="col" key={header.id} className="whitespace-nowrap px-4 py-3">{flexRender(header.column.columnDef.header, header.getContext())}</th>)}</tr>)}</thead><tbody>{table.getRowModel().rows.map((row) => <tr key={row.id} className="border-t border-[var(--border)]">{row.getVisibleCells().map((cell) => <td className="px-4 py-3" key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>)}</tr>)}</tbody></table></div> : <p className="rounded-xl bg-[var(--surface-soft)] p-5">{data.total === 0 && !query.search && query.status === "all" && query.priority === "all" ? "No tasks yet. Add a personal task to plan your next action." : "No tasks on this page. Clear your filters or return to page 1."}<button className="ml-2 underline min-h-11" onClick={() => changeQuery({ search: "", status: "all", priority: "all", page: 1 })}>Reset table</button></p>)}
    {data && <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm"><span>{data.total} matching tasks</span><label>Rows per page <select className="field min-h-11 px-2" value={query.pageSize} onChange={(e) => changeQuery({ pageSize: Number(e.target.value) })}>{[10, 25].map((size) => <option key={size}>{size}</option>)}</select></label><div className="flex items-center gap-3"><button className="secondary-button min-h-11 px-3 py-2" disabled={query.page <= 1} onClick={() => changeQuery({ page: query.page - 1 })}>Previous</button><label>Page <input type="number" className="field min-h-11 w-16 px-2" aria-label="Page number" min={1} max={pages ?? 1} value={query.page} onChange={(e) => { const page = Number(e.target.value); if (Number.isInteger(page) && page >= 1 && page <= (pages ?? 1)) changeQuery({ page }); }} /> of {pages}</label><button className="secondary-button min-h-11 px-3 py-2" disabled={query.page >= (pages ?? 1)} onClick={() => changeQuery({ page: query.page + 1 })}>Next</button></div></div>}
    <TaskDialog key={active?.task.id ?? "new"} task={adding ? undefined : active?.task} open={adding || active?.mode === "edit"} disabled={pending} save={save} remove={remove}
      onOpenChange={(open) => { if (!open) { setAdding(false); setActive(null); } }} />
    {active?.mode === "view" && <TaskDetailsDialog task={active.task} open onOpenChange={(open) => { if (!open) setActive(null); }} />}
  </>;
}
