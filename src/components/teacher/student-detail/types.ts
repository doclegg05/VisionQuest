import { type ReadinessBreakdown } from "@/lib/progression/readiness-score";
import {
  GOAL_RESOURCE_TYPE_LABELS,
  type GoalPlanEntry,
} from "@/lib/goal-resource-links";

export interface StudentTabProps {
  studentId: string;
  studentName: string;
}

export interface MoodEntryData {
  id: string;
  score: number;
  context: string | null;
  extractedAt: string;
}

export interface GoalData {
  id: string;
  level: string;
  content: string;
  status: string;
  parentId: string | null;
  createdAt: string;
}

export interface OrientationItemData {
  id: string;
  label: string;
  required: boolean;
}

export interface OrientationProgressData {
  itemId: string;
  completed: boolean;
  completedAt: string | null;
}

export interface CertTemplateData {
  id: string;
  label: string;
  required: boolean;
  needsFile: boolean;
  needsVerify: boolean;
  url: string | null;
}

export interface CertRequirementData {
  id: string;
  templateId: string;
  completed: boolean;
  completedAt: string | null;
  verifiedBy: string | null;
  verifiedAt: string | null;
  fileId: string | null;
  notes: string | null;
}

export interface ConversationSummary {
  id: string;
  module: string;
  stage: string;
  title: string | null;
  updatedAt: string;
  lastMessagePreview: string | null;
  messageCount: number;
  userMessageCount: number;
  createdAt: string;
  duration: number | null;
}

export interface PortfolioItemData {
  id: string;
  title: string;
  type: string;
  createdAt: string;
}

export interface FileData {
  id: string;
  filename: string;
  category: string;
  uploadedAt: string;
}

export interface AppointmentData {
  id: string;
  title: string;
  description: string | null;
  startsAt: string;
  endsAt: string;
  status: string;
  locationType: string;
  locationLabel: string | null;
  meetingUrl: string | null;
  notes: string | null;
  followUpRequired: boolean;
  advisorName: string;
}

export interface TaskData {
  id: string;
  title: string;
  description: string | null;
  dueAt: string | null;
  status: string;
  priority: string;
  completedAt: string | null;
  createdAt: string;
  appointmentId: string | null;
  createdByName: string;
}

export interface NoteData {
  id: string;
  category: string;
  body: string;
  visibility: string;
  createdAt: string;
  authorName: string;
}

export interface AlertData {
  id: string;
  type: string;
  severity: string;
  title: string;
  summary: string;
  sourceType: string | null;
  sourceId: string | null;
  detectedAt: string;
}

export interface GoalEvidenceData {
  goalId: string;
  linkId: string;
  resourceType: keyof typeof GOAL_RESOURCE_TYPE_LABELS;
  resourceId: string;
  title: string;
  linkStatus: string;
  evidenceStatus: "not_started" | "in_progress" | "submitted" | "completed" | "approved" | "blocked";
  evidenceSource: "none" | "student_update" | "system" | "teacher_review";
  reviewNeeded: boolean;
  evidenceLabel: string;
  summary: string;
  lastObservedAt: string | null;
  dueAt: string | null;
  notes: string | null;
}

export interface ReviewQueueItemData {
  key: string;
  kind: "goal_needs_resource" | "goal_resource_stale" | "goal_review_pending";
  severity: "medium" | "high";
  goalId: string;
  goalTitle: string;
  linkId: string | null;
  resourceTitle: string | null;
  summary: string;
  dueAt: string | null;
  detectedAt: string | null;
}

export interface FormSubmissionData {
  id: string;
  formId: string;
  title: string;
  description: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
  reviewedAt: string | null;
  notes: string | null;
  file: {
    id: string;
    filename: string;
    mimeType: string;
    uploadedAt: string;
  } | null;
  signatureFile: {
    id: string;
    filename: string;
  } | null;
}

export interface PublicCredentialPageData {
  isPublic: boolean;
  slug: string;
  headline: string | null;
  updatedAt?: string;
}

export interface ApplicationData {
  id: string;
  status: string;
  updatedAt: string;
  appliedAt: string | null;
  opportunity: {
    id: string;
    title: string;
    company: string;
    type: string;
    deadline: string | null;
  };
}

export interface EventRegistrationData {
  id: string;
  status: string;
  registeredAt: string;
  updatedAt: string;
  event: {
    id: string;
    title: string;
    startsAt: string;
    location: string | null;
  };
}

export interface StudentData {
  student: {
    id: string;
    studentId: string;
    displayName: string;
    email: string | null;
    createdAt: string;
    isActive: boolean;
  };
  progression: {
    xp: number;
    level: number;
    streaks: { daily: { current: number; longest: number } };
    achievements: string[];
  };
  readinessScore: number;
  readinessBreakdown: ReadinessBreakdown;
  goals: GoalData[];
  goalPlans: GoalPlanEntry[];
  goalEvidence: GoalEvidenceData[];
  reviewQueue: ReviewQueueItemData[];
  formSubmissions: FormSubmissionData[];
  orientation: {
    items: OrientationItemData[];
    progress: OrientationProgressData[];
  };
  certification: {
    templates: CertTemplateData[];
    cert: {
      id: string;
      status: string;
      requirements: CertRequirementData[];
    } | null;
  };
  publicCredentialPage: PublicCredentialPageData | null;
  applications: ApplicationData[];
  eventRegistrations: EventRegistrationData[];
  portfolio: PortfolioItemData[];
  hasResume: boolean;
  files: FileData[];
  appointments: AppointmentData[];
  tasks: TaskData[];
  notes: NoteData[];
  alerts: AlertData[];
  conversations: ConversationSummary[];
  careerDiscovery: {
    status: string;
    topClusters: string[];
    sageSummary: string | null;
    interests: string[];
    strengths: string[];
    subjects: string[];
    problems: string[];
    values: string[];
    circumstances: string[];
    completedAt: string | null;
  } | null;
}
