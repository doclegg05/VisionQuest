import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

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
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const resume = await prisma.resumeData.findUnique({
    where: { studentId: session.id },
  });

  let data: ResumeContent = EMPTY_RESUME;
  if (resume) {
    try {
      data = JSON.parse(resume.data);
    } catch (err) {
      console.warn("Failed to parse resume data for student", session.id, err);
    }
  }
  return NextResponse.json({ resume: data, displayName: session.displayName });
}

// POST — save resume data
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const data = JSON.stringify(body.resume || EMPTY_RESUME);

  await prisma.resumeData.upsert({
    where: { studentId: session.id },
    update: { data },
    create: { studentId: session.id, data },
  });

  return NextResponse.json({ ok: true });
}
