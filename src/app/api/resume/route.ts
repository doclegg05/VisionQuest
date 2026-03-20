import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { syncStudentAlerts } from "@/lib/advising";
import { logger } from "@/lib/logger";
import { withAuth } from "@/lib/api-error";

export interface ResumeContent {
  objective: string;
  skills: string[];
  experience: { title: string; company: string; dates: string; description: string }[];
  education: { school: string; degree: string; dates: string }[];
  references: string;
}

const EMPTY_RESUME: ResumeContent = {
  objective: "",
  skills: [],
  experience: [],
  education: [],
  references: "",
};

// GET — get student's resume data
export const GET = withAuth(async (session) => {
  const resume = await prisma.resumeData.findUnique({
    where: { studentId: session.id },
  });

  let data: ResumeContent = EMPTY_RESUME;
  if (resume) {
    try {
      data = JSON.parse(resume.data);
    } catch (err) {
      logger.warn("Failed to parse resume data for student", { studentId: session.id, error: String(err) });
    }
  }
  return NextResponse.json({ resume: data, displayName: session.displayName });
});

// POST — save resume data
export const POST = withAuth(async (session, req: Request) => {
  const body = await req.json();
  const data = JSON.stringify(body.resume || EMPTY_RESUME);

  await prisma.resumeData.upsert({
    where: { studentId: session.id },
    update: { data },
    create: { studentId: session.id, data },
  });

  await syncStudentAlerts(session.id);

  return NextResponse.json({ ok: true });
});
