import { z } from "zod";
import { badRequest } from "./api-error";

/**
 * Parse and validate a request body against a Zod schema.
 * Throws badRequest() with the first validation error on failure.
 *
 * Usage:
 *   const data = await parseBody(req, loginSchema);
 *   // data is fully typed
 */
export async function parseBody<T extends z.ZodTypeAny>(
  req: Request,
  schema: T,
): Promise<z.infer<T>> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw badRequest("Invalid JSON body.");
  }

  const result = schema.safeParse(raw);
  if (!result.success) {
    const first = result.error.issues[0];
    throw badRequest(first?.message || "Invalid request body.");
  }
  return result.data;
}

// ─── Auth Schemas ───────────────────────────────────────────────────────────

export const loginSchema = z.object({
  studentId: z.string().min(1, "Student ID is required.").max(50, "Student ID is too long."),
  password: z.string().min(1, "Password is required.").max(200, "Password is too long."),
});

export const createStudentSchema = z.object({
  studentId: z.string().min(3, "Username must be at least 3 characters.").max(50, "Username must be 50 characters or fewer."),
  displayName: z.string().min(1, "Name is required.").max(100, "Name must be 100 characters or fewer."),
  email: z.string().email("A valid email address is required.").max(200, "Email is too long.").optional().or(z.literal("")),
  password: z.string().min(6, "Password must be at least 6 characters.").max(200, "Password must be 200 characters or fewer."),
});

// ─── Teacher Registration Schema ────────────────────────────────────────────

export const registerTeacherSchema = z.object({
  teacherKey: z.string().min(1, "Teacher key is required."),
  displayName: z.string().min(1, "Display name is required.").max(100, "Display name must be 100 characters or fewer."),
  email: z.string().email("A valid email address is required.").max(200, "Email is too long."),
  password: z.string().min(8, "Password must be at least 8 characters.").max(128, "Password must be 128 characters or fewer."),
});

// ─── Password Reset Schema ─────────────────────────────────────────────────

export const resetPasswordSchema = z.object({
  token: z.string().min(1, "Reset token is required."),
  password: z.string().min(6, "Password must be at least 6 characters.").max(128, "Password must be 128 characters or fewer."),
});

// ─── Forgot Password Schema ───────────────────────────────────────────────

export const forgotPasswordSchema = z.object({
  login: z.string().min(1, "Enter the email address or student ID for your account.").max(200, "Login is too long."),
});

// ─── Reset Password (Security Questions) Schema ──────────────────────────

export const resetPasswordQuestionsSchema = z.object({
  login: z.string().min(1, "Enter the email address or student ID for your account.").max(200, "Login is too long."),
  password: z.string().min(6, "Password must be at least 6 characters.").max(200, "Password must be 200 characters or fewer."),
  securityQuestions: z.record(z.string(), z.string()),
});

// ─── Chat Schemas ───────────────────────────────────────────────────────────

export const chatSendSchema = z.object({
  message: z.string().min(1, "Message is required.").max(10000, "Message too long. Maximum 10,000 characters."),
  conversationId: z.string().cuid("Invalid conversation ID.").nullish(),
  requestedStage: z.string().max(64).optional(),
});

// ─── Settings Schemas ───────────────────────────────────────────────────────

export const apiKeySchema = z.object({
  apiKey: z.string().min(1, "API key is required.").max(500, "API key is too long."),
});

// ─── Application Schemas ────────────────────────────────────────────────────

export const applicationSchema = z.object({
  company: z.string().min(1, "Company name is required.").max(200),
  position: z.string().min(1, "Position is required.").max(200),
  status: z.enum(["saved", "applied", "interviewing", "offer", "rejected", "accepted"]).default("saved"),
  url: z.string().url("Invalid URL.").max(500).nullish(),
  notes: z.string().max(2000).nullish(),
});

// ─── Vision Board Schemas ───────────────────────────────────────────────────

export const visionBoardItemSchema = z.object({
  type: z.enum(["image", "text", "quote", "goal"]),
  content: z.string().min(1, "Content is required.").max(2000),
  imageUrl: z.string().url().max(500).nullish(),
  color: z.string().max(20).nullish(),
  positionX: z.number().min(0).max(2000).optional(),
  positionY: z.number().min(0).max(2000).optional(),
  width: z.number().min(50).max(1000).optional(),
  height: z.number().min(50).max(1000).optional(),
  goalId: z.string().nullish(),
});
