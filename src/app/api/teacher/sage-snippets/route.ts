import { NextResponse } from "next/server";
import { withTeacherAuth } from "@/lib/api-error";
import { prisma } from "@/lib/db";
import { logAuditEvent } from "@/lib/audit";
import { invalidatePrefix } from "@/lib/cache";

// GET — list all active snippets (teacher view)
export const GET = withTeacherAuth(async (_session) => {
  const snippets = await prisma.sageSnippet.findMany({
    where: { isActive: true },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ snippets });
});

// POST — create a new snippet
export const POST = withTeacherAuth(async (session, req: Request) => {
  const body = await req.json() as { question?: unknown; answer?: unknown; keywords?: unknown };
  const { question, answer, keywords } = body;

  if (!question || typeof question !== "string" || question.trim() === "") {
    return NextResponse.json({ error: "question is required" }, { status: 400 });
  }
  if (!answer || typeof answer !== "string" || answer.trim() === "") {
    return NextResponse.json({ error: "answer is required" }, { status: 400 });
  }

  const keywordsArray = Array.isArray(keywords)
    ? (keywords as unknown[]).filter((k): k is string => typeof k === "string")
    : [];

  const snippet = await prisma.sageSnippet.create({
    data: {
      question: question.trim(),
      answer: answer.trim(),
      keywords: keywordsArray,
      authorId: session.id,
    },
  });

  invalidatePrefix("sage:snippets");

  await logAuditEvent({
    actorId: session.id,
    actorRole: session.role,
    action: "sage_snippet.created",
    targetType: "sage_snippet",
    targetId: snippet.id,
    summary: `Created Sage snippet: "${snippet.question.slice(0, 80)}"`,
  });

  return NextResponse.json({ snippet }, { status: 201 });
});

// PATCH — update an existing snippet
export const PATCH = withTeacherAuth(async (session, req: Request) => {
  const body = await req.json() as {
    id?: unknown;
    question?: unknown;
    answer?: unknown;
    keywords?: unknown;
    isActive?: unknown;
  };
  const { id, question, answer, keywords, isActive } = body;

  if (!id || typeof id !== "string") {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const existing = await prisma.sageSnippet.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "Snippet not found" }, { status: 404 });
  }

  const data: {
    question?: string;
    answer?: string;
    keywords?: string[];
    isActive?: boolean;
  } = {};

  if (question !== undefined) {
    if (typeof question !== "string" || question.trim() === "") {
      return NextResponse.json({ error: "question must be a non-empty string" }, { status: 400 });
    }
    data.question = question.trim();
  }

  if (answer !== undefined) {
    if (typeof answer !== "string" || answer.trim() === "") {
      return NextResponse.json({ error: "answer must be a non-empty string" }, { status: 400 });
    }
    data.answer = answer.trim();
  }

  if (keywords !== undefined) {
    data.keywords = Array.isArray(keywords)
      ? (keywords as unknown[]).filter((k): k is string => typeof k === "string")
      : [];
  }

  if (isActive !== undefined) {
    data.isActive = Boolean(isActive);
  }

  const snippet = await prisma.sageSnippet.update({ where: { id }, data });

  invalidatePrefix("sage:snippets");

  await logAuditEvent({
    actorId: session.id,
    actorRole: session.role,
    action: "sage_snippet.updated",
    targetType: "sage_snippet",
    targetId: snippet.id,
    summary: `Updated Sage snippet: "${snippet.question.slice(0, 80)}"`,
  });

  return NextResponse.json({ snippet });
});

// DELETE — hard delete a snippet
export const DELETE = withTeacherAuth(async (session, req: Request) => {
  const body = await req.json() as { id?: unknown };
  const { id } = body;

  if (!id || typeof id !== "string") {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const existing = await prisma.sageSnippet.findUnique({
    where: { id },
    select: { id: true, question: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "Snippet not found" }, { status: 404 });
  }

  await prisma.sageSnippet.delete({ where: { id } });

  invalidatePrefix("sage:snippets");

  await logAuditEvent({
    actorId: session.id,
    actorRole: session.role,
    action: "sage_snippet.deleted",
    targetType: "sage_snippet",
    targetId: id,
    summary: `Deleted Sage snippet: "${existing.question.slice(0, 80)}"`,
  });

  return NextResponse.json({ ok: true });
});
