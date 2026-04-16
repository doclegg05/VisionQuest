import { NextResponse } from "next/server";
import { withRegistry } from "@/lib/registry/middleware";
import { assertStaffCanManageStudent } from "@/lib/classroom";
import { prisma } from "@/lib/db";
import {
  buildGoalEvidenceEntries,
  buildGoalReviewQueue,
  serializeGoalEvidenceEntries,
  serializeGoalReviewQueue,
} from "@/lib/goal-evidence";
import { buildGoalPlanEntries } from "@/lib/goal-plan";
import { serializeGoalPlanEntries, toGoalResourceLinkView } from "@/lib/goal-resource-links";
import { parseState } from "@/lib/progression/engine";
import { FORMS } from "@/lib/spokes/forms";
import { fetchStudentReadinessData } from "@/lib/progression/fetch-readiness-data";

// GET — individual student detail for teacher view
export const GET = withRegistry("admin.student_detail", async (session, _req, ctx, _tool) => {
  const { id } = await ctx.params;
  await assertStaffCanManageStudent(session, id);

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
          pathwayId: true,
          createdAt: true,
          pathway: {
            select: { id: true, label: true, active: true },
          },
        },
        orderBy: { createdAt: "asc" },
      },
      goalResourceLinks: {
        select: {
          id: true,
          goalId: true,
          resourceType: true,
          resourceId: true,
          title: true,
          description: true,
          url: true,
          linkType: true,
          status: true,
          dueAt: true,
          notes: true,
          assignedById: true,
          createdAt: true,
          updatedAt: true,
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
          updatedAt: true,
        },
      },
      formSubmissions: {
        select: {
          id: true,
          formId: true,
          fileId: true,
          signatureFileId: true,
          status: true,
          createdAt: true,
          updatedAt: true,
          reviewedAt: true,
          notes: true,
        },
        orderBy: { updatedAt: "desc" },
      },
      portfolioItems: {
        select: {
          id: true,
          title: true,
          type: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: { createdAt: "desc" },
      },
      applications: {
        select: {
          id: true,
          opportunityId: true,
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
          eventId: true,
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
            take: 1,
          },
        },
        orderBy: { updatedAt: "desc" },
      },
      careerDiscovery: {
        select: {
          status: true,
          interests: true,
          strengths: true,
          subjects: true,
          problems: true,
          values: true,
          circumstances: true,
          topClusters: true,
          clusterScores: true,
          sageSummary: true,
          riasecScores: true,
          hollandCode: true,
          nationalClusters: true,
          transferableSkills: true,
          workValues: true,
          assessmentSummary: true,
          completedAt: true,
        },
      },
    },
  });

  if (!student) {
    return NextResponse.json({ error: "Student not found" }, { status: 404 });
  }

  // Get orientation items for context
  const formFileIds = [
    ...student.formSubmissions.map((s) => s.fileId),
    ...student.formSubmissions.map((s) => s.signatureFileId).filter(Boolean),
  ].filter(Boolean) as string[];
  const [orientationItems, certTemplates, formFiles, readinessData] = await Promise.all([
    prisma.orientationItem.findMany({
      orderBy: { sortOrder: "asc" },
    }),
    prisma.certTemplate.findMany({
      where: { certType: "ready-to-work" },
      orderBy: { sortOrder: "asc" },
    }),
    formFileIds.length > 0
      ? prisma.fileUpload.findMany({
          where: { id: { in: formFileIds } },
          select: {
            id: true,
            filename: true,
            mimeType: true,
            uploadedAt: true,
          },
        })
      : Promise.resolve([]),
    fetchStudentReadinessData(id),
  ]);
  const formDefinitionById = new Map(FORMS.map((form) => [form.id, form]));
  const formFileById = new Map(formFiles.map((file) => [file.id, file]));

  // Parse progression (for xp/level/streaks/achievements display and goal-evidence building)
  let parsedProgression = parseState(null);
  let progression = { xp: 0, level: 1, streaks: { daily: { current: 0, longest: 0 } }, achievements: [] as string[] };
  if (student.progression?.state) {
    try {
      progression = JSON.parse(student.progression.state) as typeof progression;
      parsedProgression = parseState(student.progression.state);
    } catch { /* ignore */ }
  }

  const readinessResult = readinessData.readiness;

  // Build conversation summaries (message stats + preview, not full transcripts)
  // messages is take:1 desc — only the newest message is loaded for the preview.
  const conversationSummaries = student.conversations.map((c) => {
    const lastMsg = c.messages[0] ?? null;

    return {
      id: c.id,
      module: c.module,
      stage: c.stage,
      title: c.title,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
      messageCount: c._count.messages,
      lastMessagePreview: lastMsg
        ? lastMsg.content.substring(0, 150) + (lastMsg.content.length > 150 ? "..." : "")
        : null,
    };
  });
  const goalPlans = serializeGoalPlanEntries(await buildGoalPlanEntries({
    goals: student.goals,
    links: student.goalResourceLinks
      .map((link) => toGoalResourceLinkView(link))
      .filter((link): link is NonNullable<typeof link> => !!link),
  }));
  const goalEvidence = serializeGoalEvidenceEntries(buildGoalEvidenceEntries({
    links: goalPlans.flatMap((plan) => plan.links),
    progressionState: parsedProgression,
    formSubmissions: student.formSubmissions,
    orientationProgress: student.orientationProgress,
    certification: student.certifications[0]
      ? {
          status: student.certifications[0].status,
          startedAt: student.certifications[0].startedAt,
          completedAt: student.certifications[0].completedAt,
          requirements: student.certifications[0].requirements.map((requirement) => ({
            templateId: requirement.templateId,
            completed: requirement.completed,
            completedAt: requirement.completedAt,
            verifiedBy: requirement.verifiedBy,
            verifiedAt: requirement.verifiedAt,
          })),
        }
      : null,
    portfolioItems: student.portfolioItems,
    resumeData: student.resumeData,
    publicCredentialPage: student.publicCredentialPage,
    applications: student.applications,
    eventRegistrations: student.eventRegistrations,
  }));
  const reviewQueue = serializeGoalReviewQueue(buildGoalReviewQueue({
    goals: student.goals,
    links: goalPlans.flatMap((plan) => plan.links),
    evidenceEntries: goalEvidence,
  }));

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
    goalPlans,
    goalEvidence,
    reviewQueue,
    formSubmissions: student.formSubmissions.map((submission) => {
      const form = formDefinitionById.get(submission.formId);
      const file = formFileById.get(submission.fileId);
      const sigFile = submission.signatureFileId ? formFileById.get(submission.signatureFileId) : null;
      return {
        id: submission.id,
        formId: submission.formId,
        title: form?.title || submission.formId,
        description: form?.description || null,
        status: submission.status,
        createdAt: submission.createdAt,
        updatedAt: submission.updatedAt,
        reviewedAt: submission.reviewedAt,
        notes: submission.notes,
        file: file
          ? {
              id: file.id,
              filename: file.filename,
              mimeType: file.mimeType,
              uploadedAt: file.uploadedAt,
            }
          : null,
        signatureFile: sigFile
          ? { id: sigFile.id, filename: sigFile.filename }
          : null,
      };
    }),
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
    careerDiscovery: student.careerDiscovery
      ? {
          status: student.careerDiscovery.status,
          topClusters: student.careerDiscovery.topClusters,
          sageSummary: student.careerDiscovery.sageSummary,
          interests: safeJsonParse(student.careerDiscovery.interests),
          strengths: safeJsonParse(student.careerDiscovery.strengths),
          subjects: safeJsonParse(student.careerDiscovery.subjects),
          problems: safeJsonParse(student.careerDiscovery.problems),
          values: safeJsonParse(student.careerDiscovery.values),
          circumstances: safeJsonParse(student.careerDiscovery.circumstances),
          riasecScores: safeJsonParse(student.careerDiscovery.riasecScores),
          hollandCode: student.careerDiscovery.hollandCode,
          nationalClusters: safeJsonParse(student.careerDiscovery.nationalClusters),
          transferableSkills: safeJsonParse(student.careerDiscovery.transferableSkills),
          workValues: safeJsonParse(student.careerDiscovery.workValues),
          assessmentSummary: student.careerDiscovery.assessmentSummary,
          completedAt: student.careerDiscovery.completedAt,
        }
      : null,
  });
});

function safeJsonParse(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
