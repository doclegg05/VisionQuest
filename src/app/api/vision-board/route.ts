import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { recordVisionBoardItem } from "@/lib/progression/engine";
import { updateProgression } from "@/lib/progression/service";
import { logger } from "@/lib/logger";
import { withAuth } from "@/lib/api-error";

// GET — list all vision board items for student
export const GET = withAuth(async (session) => {
  const items = await prisma.visionBoardItem.findMany({
    where: { studentId: session.id },
    orderBy: [{ zIndex: "asc" }, { createdAt: "asc" }],
  });

  return NextResponse.json({ items });
});

// POST — create new item
export const POST = withAuth(async (session, req: NextRequest) => {
  const body = await req.json();
  const { type, content, fileId, goalId, posX, posY, color, pinColor } = body;

  if (!type || !["image", "note", "goal"].includes(type)) {
    return NextResponse.json({ error: "Valid type required (image, note, goal)." }, { status: 400 });
  }

  // Validate fileId ownership if provided
  if (fileId) {
    const file = await prisma.fileUpload.findFirst({
      where: { id: fileId, studentId: session.id },
    });
    if (!file) return NextResponse.json({ error: "File not found." }, { status: 404 });
  }

  // Validate goalId ownership if provided
  if (goalId) {
    const goal = await prisma.goal.findFirst({
      where: { id: goalId, studentId: session.id },
    });
    if (!goal) return NextResponse.json({ error: "Goal not found." }, { status: 404 });
  }

  // Get max zIndex
  const maxZ = await prisma.visionBoardItem.aggregate({
    where: { studentId: session.id },
    _max: { zIndex: true },
  });

  // Random rotation between -3 and +3 degrees
  const rotation = Math.round((Math.random() * 6 - 3) * 10) / 10;

  const item = await prisma.visionBoardItem.create({
    data: {
      studentId: session.id,
      type,
      content: content || null,
      fileId: fileId || null,
      goalId: goalId || null,
      posX: posX ?? 30 + Math.random() * 40, // Random center-ish position
      posY: posY ?? 20 + Math.random() * 40,
      color: color || (type === "note" ? "yellow" : null),
      pinColor: pinColor || "red",
      rotation,
      zIndex: (maxZ._max.zIndex ?? 0) + 1,
    },
  });

  // Record progression
  try {
    await updateProgression(session.id, (state) => {
      recordVisionBoardItem(state, type === "goal" ? "goal_link" : "pin");
    });
  } catch (err) {
    logger.error("Failed to record vision board progression", { error: String(err) });
  }

  return NextResponse.json({ item });
});

// PUT — update item (position, content, color)
export const PUT = withAuth(async (session, req: NextRequest) => {
  const body = await req.json();
  const { id, posX, posY, width, rotation, zIndex, content, color, pinColor } = body;

  if (!id) return NextResponse.json({ error: "Item ID required." }, { status: 400 });

  // Verify ownership
  const existing = await prisma.visionBoardItem.findFirst({
    where: { id, studentId: session.id },
  });
  if (!existing) return NextResponse.json({ error: "Item not found." }, { status: 404 });

  const updated = await prisma.visionBoardItem.update({
    where: { id },
    data: {
      ...(posX !== undefined ? { posX } : {}),
      ...(posY !== undefined ? { posY } : {}),
      ...(width !== undefined ? { width } : {}),
      ...(rotation !== undefined ? { rotation } : {}),
      ...(zIndex !== undefined ? { zIndex } : {}),
      ...(content !== undefined ? { content } : {}),
      ...(color !== undefined ? { color } : {}),
      ...(pinColor !== undefined ? { pinColor } : {}),
    },
  });

  return NextResponse.json({ item: updated });
});

// DELETE — remove item
export const DELETE = withAuth(async (session, req: NextRequest) => {
  const body = await req.json();
  const { id } = body;

  if (!id) return NextResponse.json({ error: "Item ID required." }, { status: 400 });

  // Verify ownership
  const existing = await prisma.visionBoardItem.findFirst({
    where: { id, studentId: session.id },
  });
  if (!existing) return NextResponse.json({ error: "Item not found." }, { status: 404 });

  await prisma.visionBoardItem.delete({ where: { id } });

  return NextResponse.json({ ok: true });
});
