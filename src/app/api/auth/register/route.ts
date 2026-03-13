import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { hashPassword, normalizeEmail, normalizeStudentId, setSessionCookie } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { isValidEmail } from "@/lib/validation";

export async function POST(req: NextRequest) {
  try {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const rl = await rateLimit(`register:${ip}`, 5, 15 * 60 * 1000);
    if (!rl.success) {
      return NextResponse.json({ error: "Too many registration attempts. Please try again later." }, { status: 429 });
    }
    const body = await req.json();
    const studentId = normalizeStudentId(body.studentId || "");
    const displayName = (body.displayName || "").trim();
    const password = (body.password || "").trim();
    const email = normalizeEmail(body.email || "");

    if (!studentId || studentId.length < 3) {
      return NextResponse.json({ error: "Student ID must be at least 3 characters." }, { status: 400 });
    }
    if (!displayName || displayName.length < 1) {
      return NextResponse.json({ error: "Display name is required." }, { status: 400 });
    }
    if (!email || !isValidEmail(email)) {
      return NextResponse.json({ error: "A valid email address is required." }, { status: 400 });
    }
    if (!password || password.length < 6) {
      return NextResponse.json({ error: "Password must be at least 6 characters." }, { status: 400 });
    }

    const existing = await prisma.student.findFirst({
      where: {
        OR: [
          { studentId },
          { email },
        ],
      },
      select: {
        studentId: true,
        email: true,
      },
    });
    if (existing) {
      if (existing.studentId === studentId) {
        return NextResponse.json({ error: "That student ID is already taken." }, { status: 409 });
      }

      return NextResponse.json({ error: "That email is already registered." }, { status: 409 });
    }

    const { hash } = hashPassword(password);
    const student = await prisma.student.create({
      data: {
        studentId,
        displayName,
        passwordHash: hash,
        email,
        role: "student",
      },
    });

    const token = await setSessionCookie(student.id, student.role, student.sessionVersion);

    return NextResponse.json({
      token,
      student: {
        id: student.id,
        studentId: student.studentId,
        displayName: student.displayName,
        role: student.role,
      },
    });
  } catch (error) {
    console.error("Register error:", error);
    return NextResponse.json({ error: "Registration failed." }, { status: 500 });
  }
}
