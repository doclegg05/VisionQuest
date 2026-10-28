import { z } from "../zod-csp";

export const taskStatus = z.enum(["open", "in_progress", "completed"]);
export const taskPriority = z.enum(["low", "normal", "high"]);
export const taskId = z.string().cuid();
export const taskVersion = z.iso.datetime();
export const dueDate = z.union([z.literal(""), z.iso.date(), z.iso.datetime()]).nullable();
export const taskDetails = z.object({
  title: z.string().trim().min(1, "Enter a task title.").max(160),
  description: z.string().trim().max(2000).default(""),
  priority: taskPriority.default("normal"),
  dueAt: dueDate.default(null),
});
export const createTaskSchema = taskDetails.strict();
// Do not partial() defaulted fields: Zod applies their defaults even when absent,
// which would turn a legacy status-only PATCH into a staff-assignment rewrite.
export const updateTaskSchema = z.object({
  title: taskDetails.shape.title.optional(),
  description: taskDetails.shape.description.unwrap().optional(),
  priority: taskPriority.optional(),
  dueAt: dueDate.optional(),
}).extend({
  status: taskStatus.optional(),
  updatedAt: taskVersion.optional(), // Legacy status-only callers remain supported.
}).strict().refine((v) => Object.keys(v).some((key) => key !== "updatedAt"), "No changes supplied.");
export const deleteTaskSchema = z.object({ updatedAt: taskVersion }).strict();
export const bulkTaskSchema = z.object({
  status: taskStatus,
  tasks: z.array(z.object({ id: taskId, updatedAt: taskVersion }).strict()).min(1).max(25),
}).strict().refine((v) => new Set(v.tasks.map((t) => t.id)).size === v.tasks.length, "Select each task only once.");
export const taskQuerySchema = z.object({
  search: z.string().trim().max(160).default(""),
  status: z.enum(["all", "open", "in_progress", "completed"]).default("all"),
  priority: z.enum(["all", "low", "normal", "high"]).default("all"),
  sort: z.enum(["dueAt", "createdAt", "title", "status", "priority"]).default("dueAt"),
  direction: z.enum(["asc", "desc"]).default("asc"),
  page: z.coerce.number().int().min(1).max(10000).default(1),
  pageSize: z.coerce.number().int().min(1).max(25).default(10),
}).strict();
export type TaskQuery = z.infer<typeof taskQuerySchema>;
export type TaskDetails = z.infer<typeof taskDetails>;
export type TaskPatch = z.infer<typeof updateTaskSchema>;
export function parseDueDate(value: string | null | undefined) {
  return value ? new Date(value.length === 10 ? `${value}T12:00:00.000Z` : value) : null;
}
