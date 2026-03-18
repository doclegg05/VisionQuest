import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { syncStudentAlerts } from "@/lib/advising";
import { prisma } from "@/lib/db";
import { computeReadinessScore } from "@/lib/progression/readiness-score";

async function requireTeacher() {
  const session = await getSession();
  if (!session || session.role !== "teacher") return null;
  return session;
}

// GET — individual student detail for teacher view
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const teacher = await requireTeacher();
  if (!teacher) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;

  await syncStudentAlerts(id);

  const student = await prisma.student.findUnique({
    where: { id },
    select: {
      id: true,
      studentId: true,
      displayName: true,
      email: true,
      isActive: true,
      createdAt: true,
      progression: { select: { state: true } },
      goals: {
        select: {
          id: true,
          level: true,
          content: true,
          status: true,
          parentId: true,
          createdAt: true,
        },
        orderBy: { createdAt: "asc" },
      },
      orientationProgress: {
        select: {
          itemId: true,
          completed: true,
          completedAt: true,
        },
      },
      certifications: {
        select: {
          id: true,
          status: true,
          startedAt: true,
          completedAt: true,
          requirements: {
            select: {
              id: true,
              templateId: true,
              completed: true,
              completedAt: true,
              verifiedBy: true,
              verifiedAt: true,
              fileId: true,
              notes: true,
            },
          },
        },
      },
      publicCredentialPage: {
        select: {
          isPublic: true,
          slug: true,
          headline: true,
        },
      },
      portfolioItems: {
        select: {
          id: true,
          title: true,
          type: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
      },
      applications: {
        select: {
          id: true,
          status: true,
          updatedAt: true,
          appliedAt: true,
          opportunity: {
            select: {
              id: true,
              title: true,
              company: true,
              type: true,
              deadline: true,
            },
          },
        },
        orderBy: { updatedAt: "desc" },
      },
      eventRegistrations: {
        select: {
          id: true,
          status: true,
          registeredAt: true,
          updatedAt: true,
          event: {
            select: {
              id: true,
              title: true,
              startsAt: true,
              location: true,
            },
          },
        },
        orderBy: { updatedAt: "desc" },
      },
      resumeData: { select: { id: true, data: true } },
      files: {
        select: {
          id: true,
          filename: true,
          category: true,
          uploadedAt: true,
        },
        orderBy: { uploadedAt: "desc" },
      },
      appointments: {
        select: {
          id: true,
          title: true,
          description: true,
          startsAt: true,
          endsAt: true,
          status: true,
          locationType: true,
          locationLabel: true,
          meetingUrl: true,
          notes: true,
          followUpRequired: true,
          advisor: {
            select: {
              displayName: true,
            },
          },
        },
        orderBy: { startsAt: "asc" },
      },
      assignedTasks: {
        select: {
          id: true,
          title: true,
          description: true,
          dueAt: true,
          status: true,
          priority: true,
          completedAt: true,
          createdAt: true,
          appointmentId: true,
          createdBy: {
            select: {
              displayName: true,
            },
          },
        },
        orderBy: [{ status: "asc" }, { dueAt: "asc" }, { createdAt: "desc" }],
      },
      caseNotes: {
        select: {
          id: true,
          category: true,
          body: true,
          visibility: true,
          createdAt: true,
          author: {
            select: {
              displayName: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
      },
      alerts: {
        where: { status: "open" },
        select: {
          id: true,
          type: true,
          severity: true,
          title: true,
          summary: true,
          sourceType: true,
          sourceId: true,
          detectedAt: true,
        },
        orderBy: { detectedAt: "desc" },
      },
      conversations: {
        select: {
          id: true,
          module: true,
          stage: true,
          title: true,
          createdAt: true,
          updatedAt: true,
          _count: { select: { messages: true } },
          messages: {
            select: { role: true, content: true, createdAt: true },
            orderBy: { createdAt: "desc" },
          },
        },
        orderBy: { updatedAt: "desc" },
      },
    },
  });

  if (!student) {
    return NextResponse.json({ error: "Student not found" }, { status: 404 });
  }

  // Get orientation items for context
  const orientationItems = await prisma.orientationItem.findMany({
    orderBy: { sortOrder: "asc" },
  });

  // Get cert templates for context
  const certTemplates = await prisma.certTemplate.findMany({
    where: { certType: "ready-to-work" },
    orderBy: { sortOrder: "asc" },
  });

  // Parse progression
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let rawProgression: any = null;
  let progression = { xp: 0, level: 1, streaks: { daily: { current: 0, longest: 0 } }, achievements: [] as string[] };
  if (student.progression?.state) {
    try {
      rawProgression = JSON.parse(student.progression.state);
      progression = rawProgression;
    } catch { /* ignore */ }
  }

  // Compute readiness score
  const certDoneCount = student.certifications[0]
    ? student.certifications[0].requirements.filter((r) => r.completed).length
    : 0;
  const readinessResult = computeReadinessScore(
    {
      orientationComplete: rawProgression?.orientationComplete ?? false,
      completedGoalLevels: rawProgression?.completedGoalLevels ?? [],
      certificationsEarned: certDoneCount,
      portfolioItemCount: rawProgression?.portfolioItemCount ?? student.portfolioItems.length,
      resumeCreated: rawProgression?.resumeCreated ?? !!student.resumeData,
      portfolioShared: rawProgression?.portfolioShared ?? false,
      platformsVisited: rawProgression?.platformsVisited ?? [],
      longestStreak: rawProgression?.streaks?.daily?.longest ?? rawProgression?.longestStreak ?? 0,
      level: rawProgression?.level ?? 1,
    },
    certTemplates.filter((t) => t.required).length || 19,
  );

  // Build conversation summaries (message stats + preview, not full transcripts)
  const conversationSummaries = student.conversations.map((c) => {
    const lastMsg = c.messages[0] ?? null;
    const firstMsg = c.messages.length > 0 ? c.messages[c.messages.length - 1] : null;
    const userMessageCount = c.messages.filter((m) => m.role === "user").length;

    return {
      id: c.id,
      module: c.module,
      stage: c.stage,
      title: c.title,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
      messageCount: c._count.messages,
      userMessageCount,
      duration: firstMsg && lastMsg
        ? { firstMessageAt: firstMsg.createdAt.toISOString(), lastMessageAt: lastMsg.createdAt.toISOString() }
        : null,
      lastMessagePreview: lastMsg
        ? lastMsg.content.substring(0, 150) + (lastMsg.content.length > 150 ? "..." : "")
        : null,
    };
  });

  return NextResponse.json({
    student: {
      id: student.id,
      studentId: student.studentId,
      displayName: student.displayName,
      email: student.email,
      isActive: student.isActive,
      createdAt: student.createdAt,
    },
    progression,
    readinessScore: readinessResult.score,
    readinessBreakdown: readinessResult.breakdown,
    goals: student.goals,
    orientation: {
      items: orientationItems,
      progress: student.orientationProgress,
    },
    certification: {
      templates: certTemplates,
      cert: student.certifications[0] || null,
    },
    publicCredentialPage: student.publicCredentialPage,
    applications: student.applications,
    eventRegistrations: student.eventRegistrations,
    portfolio: student.portfolioItems,
    hasResume: !!student.resumeData,
    files: student.files,
    appointments: student.appointments.map((appointment) => ({
      ...appointment,
      advisorName: appointment.advisor.displayName,
    })),
    tasks: student.assignedTasks.map((task) => ({
      ...task,
      createdByName: task.createdBy.displayName,
    })),
    notes: student.caseNotes.map((note) => ({
      ...note,
      authorName: note.author.displayName,
    })),
    alerts: student.alerts,
    conversations: conversationSummaries,
  });
}
