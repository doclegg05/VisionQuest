import { Prisma, type StudentTask } from "@prisma/client";
import { withAppTransaction } from "@/lib/db";
import { badRequest, conflict, forbidden, isStaffRole, notFound, type Session } from "@/lib/api-error";
import { buildManagedStudentWhere } from "@/lib/classroom";
import { syncStudentAlerts } from "@/lib/advising";
import { tryLogAuditEvent } from "@/lib/audit";
import { logger } from "@/lib/logger";
import { parseDueDate, type TaskDetails, type TaskPatch, type TaskQuery } from "./task-schemas";

export function requireStudent(session: Session) {
  if (session.role !== "student") throw forbidden("Student access required.");
}
export function taskDto(task: StudentTask) {
  return {
    id: task.id, studentId: task.studentId, title: task.title, description: task.description,
    status: task.status, priority: task.priority, personal: task.createdById === task.studentId,
    dueAt: task.dueAt?.toISOString() ?? null, completedAt: task.completedAt?.toISOString() ?? null,
    createdAt: task.createdAt.toISOString(), updatedAt: task.updatedAt.toISOString(),
  };
}
export type TaskDto = ReturnType<typeof taskDto>;
export interface TaskPage { tasks: TaskDto[]; total: number; page: number; pageSize: number; fetchedAt: string }

export async function readTasks(studentId: string, query: TaskQuery): Promise<TaskPage> {
  return withAppTransaction(async (tx) => {
    const where: Prisma.StudentTaskWhereInput = {
      studentId,
      ...(query.status !== "all" ? { status: query.status } : {}),
      ...(query.priority !== "all" ? { priority: query.priority } : {}),
      ...(query.search ? { OR: [
        { title: { contains: query.search, mode: "insensitive" } },
        { description: { contains: query.search, mode: "insensitive" } },
      ] } : {}),
    };
    const total = await tx.studentTask.count({ where });
    const tasks = await tx.studentTask.findMany({ where,
      orderBy: [{ [query.sort]: query.direction }, { id: "asc" }],
      skip: (query.page - 1) * query.pageSize, take: query.pageSize,
    });
    return { tasks: tasks.map(taskDto), total, page: query.page, pageSize: query.pageSize, fetchedAt: new Date().toISOString() };
  });
}

export async function readTask(session: Session, id: string): Promise<TaskDto> {
  requireStudent(session);
  return withAppTransaction(async (tx) => {
    // Scoped by owner so another student's task is indistinguishable from a missing one.
    const task = await tx.studentTask.findFirst({ where: { id, studentId: session.id } });
    if (!task) throw notFound("Task not found.");
    return taskDto(task);
  });
}

export function authorizeTask(session: Session, task: StudentTask, details: boolean) {
  if (!isStaffRole(session.role) && (session.role !== "student" || task.studentId !== session.id)) throw forbidden();
  if (details && !isStaffRole(session.role) && task.createdById !== session.id) {
    throw forbidden("Only your instructor can change assigned task details.");
  }
}
async function scopedTask(tx: Prisma.TransactionClient, session: Session, id: string, details: boolean) {
  const task = await tx.studentTask.findUnique({ where: { id } });
  if (!task) throw notFound("Task not found.");
  authorizeTask(session, task, details);
  if (isStaffRole(session.role)) {
    const student = await tx.student.findFirst({ where: { AND: [
      { id: task.studentId }, buildManagedStudentWhere(session),
    ] }, select: { id: true } });
    if (!student) throw forbidden("You do not have access to this student.");
  }
  return task;
}
async function transaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>) {
  try { return await withAppTransaction(work); }
  catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
      throw conflict("Tasks changed while saving. Refresh and try again.");
    }
    throw error;
  }
}
// Matches origin/main per action: task.created files under the student
// (targetType "student"); task.updated files under the task (targetType
// "task"). task.deleted has no main precedent and follows task.updated.
// The task id rides in metadata either way.
function auditSummary(action: string, task: StudentTask, assigned: boolean) {
  if (action === "task.created") return `Created ${assigned ? "follow-up " : ""}task "${task.title}".`;
  if (action === "task.deleted") return `Deleted task "${task.title}".`;
  return `Updated task "${task.title}" to ${task.status}.`;
}
async function afterCommit(session: Session, tasks: StudentTask[], action: string, assigned = false) {
  const underStudent = action === "task.created";
  const audits = await Promise.all(tasks.map((task) => tryLogAuditEvent({
    actorId: session.id, actorRole: session.role, action,
    targetType: underStudent ? "student" : "task", targetId: underStudent ? task.studentId : task.id,
    summary: auditSummary(action, task, assigned),
    metadata: { taskId: task.id, studentId: task.studentId, status: task.status },
  })));
  let alertsSynced = true;
  for (const studentId of new Set(tasks.map((task) => task.studentId))) {
    try { await syncStudentAlerts(studentId); }
    catch { alertsSynced = false; logger.warn("Task saved; alert synchronization failed", { action }); }
  }
  return { audited: audits.every((a) => a.audited), alertsSynced };
}
export async function createPersonalTask(session: Session, details: TaskDetails) {
  requireStudent(session);
  const task = await transaction((tx) => tx.studentTask.create({ data: {
    ...details, dueAt: parseDueDate(details.dueAt), description: details.description || null,
    studentId: session.id, createdById: session.id,
  } }));
  return { task: taskDto(task), ...await afterCommit(session, [task], "task.created") };
}
export async function createAssignedTask(session: Session, studentId: string, details: TaskDetails, appointmentId?: string) {
  if (!isStaffRole(session.role)) throw forbidden();
  const task = await transaction(async (tx) => {
    const student = await tx.student.findFirst({ where: { AND: [{ id: studentId }, buildManagedStudentWhere(session)] }, select: { id: true } });
    if (!student) throw forbidden("You do not have access to this student.");
    if (appointmentId && !await tx.appointment.findFirst({ where: { id: appointmentId, studentId }, select: { id: true } })) throw badRequest("Appointment not found for this student.");
    return tx.studentTask.create({ data: { ...details, description: details.description || null, dueAt: parseDueDate(details.dueAt), studentId, createdById: session.id, appointmentId: appointmentId || null } });
  });
  return { task: taskDto(task), ...await afterCommit(session, [task], "task.created", true) };
}
export async function updateTasks(session: Session, changes: { id: string; patch: TaskPatch }[]) {
  if (changes.length < 1 || changes.length > 25 || new Set(changes.map((c) => c.id)).size !== changes.length) throw badRequest("Select 1–25 distinct tasks.");
  const tasks = await transaction(async (tx) => {
    const result: StudentTask[] = [];
    // Stable lock order reduces deadlocks; all authorization and versions are checked in this transaction.
    for (const { id, patch } of [...changes].sort((a, b) => a.id.localeCompare(b.id))) {
      const details = ["title", "description", "priority", "dueAt"].some((key) => key in patch);
      const existing = await scopedTask(tx, session, id, details);
      if (details && !patch.updatedAt) throw badRequest("Refresh this task before editing.");
      if (patch.updatedAt && existing.updatedAt.toISOString() !== patch.updatedAt) throw conflict("A task has changed. Refresh before saving.");
      const { updatedAt: _version, dueAt, ...data } = patch;
      void _version;
      const updated = await tx.studentTask.updateMany({ where: { id, studentId: existing.studentId, updatedAt: existing.updatedAt }, data: {
        ...data,
        ...(dueAt !== undefined ? { dueAt: parseDueDate(dueAt) } : {}),
        ...(patch.status ? { completedAt: patch.status === "completed" ? existing.completedAt ?? new Date() : null } : {}),
        updatedAt: new Date(Math.max(Date.now(), existing.updatedAt.getTime() + 1)),
      } });
      if (updated.count !== 1) throw conflict("A task has changed. Refresh before saving.");
      result.push(await tx.studentTask.findUniqueOrThrow({ where: { id } }));
    }
    return result;
  });
  return { tasks: tasks.map(taskDto), ...await afterCommit(session, tasks, "task.updated") };
}
export async function deletePersonalTask(session: Session, id: string, updatedAt: string) {
  requireStudent(session);
  const task = await transaction(async (tx) => {
    const existing = await scopedTask(tx, session, id, true);
    if (existing.updatedAt.toISOString() !== updatedAt) throw conflict("Task changed. Refresh before deleting.");
    const deleted = await tx.studentTask.deleteMany({ where: { id, studentId: session.id, createdById: session.id, updatedAt: existing.updatedAt } });
    if (deleted.count !== 1) throw conflict("Task changed. Refresh before deleting.");
    return existing;
  });
  return { deleted: true, ...await afterCommit(session, [task], "task.deleted") };
}
