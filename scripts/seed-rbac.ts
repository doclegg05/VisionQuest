/**
 * RBAC Seed Script
 *
 * Populates the Role, Permission, and RolePermission tables from the
 * Tool Registry. Safe to re-run (uses upserts).
 *
 * Usage:
 *   npx tsx scripts/seed-rbac.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// ---------------------------------------------------------------------------
// 1. System roles
// ---------------------------------------------------------------------------
const SYSTEM_ROLES = [
  {
    name: "admin",
    displayName: "Administrator",
    hierarchyLevel: 1,
    isSystem: true,
    description: "Full system access — configuration, auditing, and user management",
  },
  {
    name: "teacher",
    displayName: "Instructor",
    hierarchyLevel: 2,
    isSystem: true,
    description: "Class management, student advising, and reporting",
  },
  {
    name: "student",
    displayName: "Student",
    hierarchyLevel: 3,
    isSystem: true,
    description: "Core learner experience — goals, chat, certifications, portfolio",
  },
] as const;

// ---------------------------------------------------------------------------
// 2. Permissions derived from the Tool Registry (src/lib/registry/tools.ts)
//    Each entry: [permissionKey, namespace, displayName, description, allowedRoles[]]
// ---------------------------------------------------------------------------
type PermSeed = readonly [string, string, string, string, readonly string[]];

const PERMISSION_SEEDS: readonly PermSeed[] = [
  // -- Auth --
  ["auth.login", "auth", "Login", "Authenticate a student or teacher with email and password", ["student", "teacher", "admin"]],
  ["auth.register_teacher", "auth", "Register Teacher", "Create a new teacher account using the TEACHER_KEY", ["teacher", "admin"]],
  ["auth.logout", "auth", "Logout", "End the current session and clear auth cookies", ["student", "teacher", "admin"]],
  ["auth.forgot_password", "auth", "Forgot Password", "Initiate password reset flow via security questions", ["student", "teacher", "admin"]],
  ["auth.reset_password", "auth", "Reset Password", "Reset password after verifying security questions", ["student", "teacher", "admin"]],
  ["auth.reset_password_questions", "auth", "Verify Security Questions", "Verify security question answers for password reset", ["student", "teacher", "admin"]],
  ["auth.session", "auth", "Get Session", "Return the current authenticated session details", ["student", "teacher", "admin"]],
  ["auth.google_oauth", "auth", "Google OAuth", "Initiate Google OAuth sign-in flow", ["student", "teacher", "admin"]],
  ["auth.google_oauth_callback", "auth", "Google OAuth Callback", "Handle Google OAuth callback and create/link session", ["student", "teacher", "admin"]],
  ["auth.security_questions_get", "auth", "Get Security Questions", "Retrieve stored security questions for the current user", ["student", "teacher", "admin"]],
  ["auth.security_questions_set", "auth", "Set Security Questions", "Store security questions and answers for password recovery", ["student", "teacher", "admin"]],

  // -- Sage --
  ["sage.chat", "sage", "Sage Chat", "Send a message to the Sage AI coach and receive a streamed response", ["student", "teacher", "admin"]],
  ["sage.conversations", "sage", "List Conversations", "List all Sage conversations for the current user", ["student", "teacher", "admin"]],
  ["sage.history", "sage", "Chat History", "Retrieve message history for a specific conversation", ["student", "teacher", "admin"]],
  ["sage.goal_extraction", "sage", "Goal Extraction", "AI extracts actionable goals from a Sage conversation", ["student", "teacher", "admin"]],
  ["sage.mood_extraction", "sage", "Mood Extraction", "AI extracts emotional wellness scores from a conversation", ["student", "teacher", "admin"]],
  ["sage.discovery_extraction", "sage", "Career Discovery Extraction", "AI extracts career interest signals from a conversation", ["student", "teacher", "admin"]],
  ["sage.summarize", "sage", "Conversation Summary", "AI summarizes a long conversation for context compression", ["student", "teacher", "admin"]],
  ["sage.resume_assist", "sage", "Resume Assist", "AI generates or refines resume content based on student profile", ["student"]],
  ["sage.resume_extract", "sage", "Resume Extract", "AI parses an uploaded resume file into structured data", ["student"]],
  ["sage.snippets_list", "sage", "Sage Snippets List", "List AI-generated Sage conversation snippets for teacher review", ["teacher", "admin"]],
  ["sage.snippets_create", "sage", "Create Sage Snippet", "Save a notable conversation snippet from Sage for review", ["teacher", "admin"]],
  ["sage.snippets_update", "sage", "Update Sage Snippet", "Edit an existing Sage conversation snippet", ["teacher", "admin"]],
  ["sage.snippets_delete", "sage", "Delete Sage Snippet", "Remove a Sage conversation snippet", ["teacher", "admin"]],
  ["sage.context_documents", "sage", "Sage Context Documents", "Manage RAG grounding documents for Sage AI knowledge base", ["teacher", "admin"]],
  ["sage.context_documents_update", "sage", "Update Sage Context Document", "Upload or modify a RAG grounding document for Sage", ["teacher", "admin"]],

  // -- Goals --
  ["goals.list", "goals", "List Goals", "Retrieve all goals for the current student", ["student", "teacher", "admin"]],
  ["goals.create", "goals", "Create Goal", "Create a new goal for the current student", ["student"]],
  ["goals.update", "goals", "Update Goal", "Update an existing goal (status, description, progress)", ["student"]],
  ["goals.resources", "goals", "Goal Resources", "List linked resources for a specific goal", ["student", "teacher", "admin"]],
  ["goals.resource_link_create", "goals", "Link Resource to Goal", "Attach a learning resource link to a student goal (teacher only)", ["teacher", "admin"]],
  ["goals.resource_link_update", "goals", "Update Goal Resource Link", "Edit an existing goal-resource link", ["student", "teacher", "admin"]],
  ["goals.confirm", "goals", "Confirm Goal", "Teacher confirms or reviews a student-created goal", ["teacher", "admin"]],
  ["goals.pathway_suggestions", "goals", "Goal Pathway Suggestions", "Get AI-suggested pathways for a specific student goal", ["teacher", "admin"]],

  // -- Orientation --
  ["orientation.progress", "orientation", "Orientation Progress", "Get or update current student orientation progress", ["student"]],
  ["orientation.step_update", "orientation", "Update Orientation Step", "Mark an orientation step as completed or update responses", ["student"]],
  ["orientation.complete", "orientation", "Complete Orientation", "Mark the entire orientation wizard as completed", ["student"]],
  ["orientation.items_list", "orientation", "List Orientation Items", "Teacher view of all orientation step configurations", ["teacher", "admin"]],
  ["orientation.items_create", "orientation", "Create Orientation Item", "Add a new orientation step to the wizard", ["teacher", "admin"]],
  ["orientation.items_update", "orientation", "Update Orientation Item", "Modify an existing orientation step configuration", ["teacher", "admin"]],
  ["orientation.items_delete", "orientation", "Delete Orientation Item", "Remove an orientation step from the wizard", ["teacher", "admin"]],

  // -- Certifications --
  ["certifications.list", "certifications", "List Certifications", "Retrieve available certifications and student progress", ["student", "teacher", "admin"]],
  ["certifications.submit", "certifications", "Submit Certification", "Student submits proof of a completed certification", ["student"]],
  ["certifications.teacher_list", "certifications", "Teacher Certifications List", "Teacher view of all student certification submissions", ["teacher", "admin"]],
  ["certifications.approve", "certifications", "Approve Certification", "Teacher approves or rejects a student certification submission", ["teacher", "admin"]],
  ["certifications.templates_create", "certifications", "Create Certification Template", "Teacher creates a new certification template definition", ["teacher", "admin"]],
  ["certifications.templates_delete", "certifications", "Delete Certification Template", "Teacher removes a certification template", ["teacher", "admin"]],
  ["certifications.credly_badges", "certifications", "Credly Badges", "Fetch earned Credly badges for the current student", ["student"]],
  ["certifications.credentials_share", "certifications", "Share Credentials", "Generate or retrieve shareable credential links", ["student"]],
  ["certifications.credentials_create", "certifications", "Create Credential Share", "Create a new shareable credential link", ["student"]],

  // -- Portfolio --
  ["portfolio.list", "portfolio", "List Portfolio Items", "Retrieve all portfolio entries for the current student", ["student", "teacher", "admin"]],
  ["portfolio.create", "portfolio", "Create Portfolio Item", "Add a new item to the student portfolio", ["student"]],
  ["portfolio.update", "portfolio", "Update Portfolio Item", "Edit an existing portfolio entry", ["student"]],
  ["portfolio.delete", "portfolio", "Delete Portfolio Item", "Remove a portfolio entry", ["student"]],
  ["portfolio.resume_get", "portfolio", "Get Resume Data", "Retrieve stored resume data for the current student", ["student"]],
  ["portfolio.resume_save", "portfolio", "Save Resume Data", "Save or update resume structured data", ["student"]],
  ["portfolio.resume_application_file", "portfolio", "Generate Application File", "Generate a downloadable resume file for job applications", ["student"]],
  ["portfolio.vision_board_list", "portfolio", "Vision Board Items", "Retrieve vision board items for the current student", ["student"]],
  ["portfolio.vision_board_create", "portfolio", "Create Vision Board Item", "Add a new vision board entry (image, text, goal)", ["student"]],
  ["portfolio.vision_board_update", "portfolio", "Update Vision Board Item", "Edit an existing vision board entry", ["student"]],
  ["portfolio.vision_board_delete", "portfolio", "Delete Vision Board Item", "Remove a vision board entry", ["student"]],
  ["portfolio.documents_list", "portfolio", "List Documents", "Retrieve uploaded documents for the current student", ["student", "teacher", "admin"]],
  ["portfolio.documents_download", "portfolio", "Download Document", "Download a previously uploaded document", ["student", "teacher", "admin"]],

  // -- Career --
  ["career.opportunities", "career", "List Opportunities", "Browse career and training opportunities", ["student"]],
  ["career.events", "career", "List Events", "Browse upcoming career events, workshops, and job fairs", ["student", "teacher", "admin"]],
  ["career.events_register", "career", "Register for Event", "Register the student for a career event", ["student"]],
  ["career.events_unregister", "career", "Unregister from Event", "Cancel event registration", ["student"]],
  ["career.apply", "career", "Apply to Opportunity", "Submit an application for a career opportunity", ["student"]],
  ["career.jobs", "career", "Search Jobs", "Search aggregated job listings from external boards", ["student"]],
  ["career.jobs_save", "career", "Save Job", "Bookmark a job listing for later review", ["student"]],
  ["career.opportunities_manage", "career", "Manage Opportunities", "Teacher CRUD for career opportunities", ["teacher", "admin"]],
  ["career.opportunities_create", "career", "Create Opportunity", "Teacher creates a new career opportunity listing", ["teacher", "admin"]],
  ["career.opportunities_update", "career", "Update Opportunity", "Teacher edits an existing opportunity listing", ["teacher", "admin"]],
  ["career.opportunities_delete", "career", "Delete Opportunity", "Teacher removes an opportunity listing", ["teacher", "admin"]],
  ["career.events_manage", "career", "Manage Events", "Teacher lists all career events", ["teacher", "admin"]],
  ["career.events_create", "career", "Create Event", "Teacher creates a new career event", ["teacher", "admin"]],
  ["career.events_update", "career", "Update Event", "Teacher edits an existing career event", ["teacher", "admin"]],
  ["career.events_delete", "career", "Delete Event", "Teacher removes a career event", ["teacher", "admin"]],
  ["career.jobs_config", "career", "Job Board Config", "View or update job board scraping configuration", ["teacher", "admin"]],
  ["career.jobs_config_update", "career", "Update Job Board Config", "Modify job board scraping keywords and sources", ["teacher", "admin"]],
  ["career.jobs_refresh", "career", "Refresh Job Listings", "Trigger a manual refresh of job board data", ["teacher", "admin"]],
  ["career.pathways_list", "career", "List Pathways", "View all defined career pathways", ["teacher", "admin"]],
  ["career.pathways_create", "career", "Create Pathway", "Define a new career pathway with milestones", ["teacher", "admin"]],
  ["career.pathways_get", "career", "Get Pathway Detail", "Retrieve a single pathway with full milestone detail", ["teacher", "admin"]],
  ["career.pathways_update", "career", "Update Pathway", "Edit an existing career pathway", ["teacher", "admin"]],
  ["career.pathways_delete", "career", "Delete Pathway", "Remove a career pathway definition", ["teacher", "admin"]],

  // -- Advising --
  ["advising.availability", "advising", "View Availability", "Retrieve available advising appointment slots", ["student", "teacher", "admin"]],
  ["advising.book", "advising", "Book Appointment", "Schedule an advising appointment with an available slot", ["student"]],
  ["advising.teacher_availability_list", "advising", "Teacher Availability List", "Teacher views their own availability schedule", ["teacher", "admin"]],
  ["advising.teacher_availability_create", "advising", "Create Availability Slot", "Teacher adds a new availability slot for appointments", ["teacher", "admin"]],
  ["advising.teacher_availability_delete", "advising", "Delete Availability Slot", "Teacher removes an availability slot", ["teacher", "admin"]],
  ["advising.appointment_update", "advising", "Update Appointment", "Teacher updates appointment status (confirm, cancel, complete)", ["teacher", "admin"]],
  ["advising.appointment_reminders", "advising", "Send Appointment Reminders", "Trigger appointment reminder notifications", ["teacher", "admin"]],
  ["advising.student_appointments", "advising", "Student Appointments", "Teacher views appointment history for a specific student", ["teacher", "admin"]],
  ["advising.tasks_update", "advising", "Update Task", "Update an advising task status", ["student", "teacher", "admin"]],
  ["advising.student_tasks", "advising", "Assign Student Task", "Teacher assigns a task to a specific student", ["teacher", "admin"]],
  ["advising.alerts_update", "advising", "Update Alert", "Teacher acknowledges or dismisses a student alert", ["teacher", "admin"]],

  // -- Files --
  ["files.list", "files", "List Files", "List uploaded files for the current student", ["student", "teacher", "admin"]],
  ["files.upload", "files", "Upload File", "Upload a file to student storage (local or Supabase)", ["student"]],
  ["files.download", "files", "Download File", "Download a previously uploaded file", ["student", "teacher", "admin"]],
  ["files.delete", "files", "Delete File", "Remove a file from student storage", ["student"]],
  ["files.forms_upload", "files", "Upload Form", "Upload a signed form document", ["student"]],
  ["files.forms_sign", "files", "Sign Form", "Apply an electronic signature to a form", ["student"]],
  ["files.forms_status", "files", "Form Status", "Check the completion status of required forms", ["student"]],
  ["files.forms_list", "files", "List Forms", "List all available form templates", ["student", "teacher", "admin"]],
  ["files.forms_download", "files", "Download Form Template", "Download a blank or pre-filled form template", ["student", "teacher", "admin"]],

  // -- Learning --
  ["learning.platforms", "learning", "List LMS Platforms", "Retrieve available learning management system platforms", ["student"]],
  ["learning.visit_track", "learning", "Track LMS Visit", "Record that a student visited an LMS platform link", ["student"]],
  ["learning.lms_list", "learning", "LMS Overview", "Get overall LMS enrollment and progress data", ["student"]],
  ["learning.teacher_lms_list", "learning", "Teacher LMS Management", "Teacher view of all LMS platform configurations", ["teacher", "admin"]],
  ["learning.teacher_lms_create", "learning", "Create LMS Platform", "Teacher adds a new LMS platform link", ["teacher", "admin"]],
  ["learning.teacher_lms_update", "learning", "Update LMS Platform", "Teacher edits an existing LMS platform entry", ["teacher", "admin"]],
  ["learning.teacher_lms_delete", "learning", "Delete LMS Platform", "Teacher removes an LMS platform", ["teacher", "admin"]],
  ["learning.class_progress", "learning", "Class Progress", "Student views their class-level progress data", ["student"]],
  ["learning.mood", "learning", "Mood History", "Retrieve mood tracking history for the current student", ["student"]],

  // -- Notifications --
  ["notifications.list", "notifications", "List Notifications", "Retrieve notifications for the current user", ["student", "teacher", "admin"]],
  ["notifications.mark_read", "notifications", "Mark Notification Read", "Mark one or more notifications as read", ["student", "teacher", "admin"]],
  ["notifications.stream", "notifications", "Notification Stream", "Server-Sent Events stream for real-time notifications", ["student", "teacher", "admin"]],
  ["notifications.preferences_get", "notifications", "Get Notification Preferences", "Retrieve notification preference settings", ["student", "teacher", "admin"]],
  ["notifications.preferences_update", "notifications", "Update Notification Preferences", "Modify notification preference settings", ["student", "teacher", "admin"]],

  // -- Progression --
  ["progression.state", "progression", "Progression State", "Get the current student progression level and badge status", ["student", "teacher", "admin"]],
  ["progression.activity_log", "progression", "Activity Log", "Retrieve the student activity log for progression tracking", ["student"]],

  // -- Classes --
  ["classes.list", "classes", "List Classes", "Teacher lists all SPOKES classes they manage", ["teacher", "admin"]],
  ["classes.create", "classes", "Create Class", "Teacher creates a new SPOKES class section", ["teacher", "admin"]],
  ["classes.get", "classes", "Get Class Detail", "Retrieve detailed info about a specific class", ["teacher", "admin"]],
  ["classes.update", "classes", "Update Class", "Teacher updates class metadata (name, dates, etc.)", ["teacher", "admin"]],
  ["classes.roster", "classes", "Class Roster", "View all students enrolled in a class", ["teacher", "admin"]],
  ["classes.enroll", "classes", "Enroll Student", "Enroll a student in a class section", ["teacher", "admin"]],
  ["classes.enrollment_update", "classes", "Update Enrollment", "Update a student enrollment status (active, withdrawn, etc.)", ["teacher", "admin"]],
  ["classes.requirements_list", "classes", "List Class Requirements", "View all requirements defined for a class", ["teacher", "admin"]],
  ["classes.requirements_create", "classes", "Create Class Requirement", "Add a new requirement to a class", ["teacher", "admin"]],
  ["classes.requirements_update", "classes", "Update Class Requirement", "Modify an existing class requirement", ["teacher", "admin"]],
  ["classes.requirements_delete", "classes", "Delete Class Requirement", "Remove a class requirement", ["teacher", "admin"]],
  ["classes.welcome_letter_get", "classes", "Get Welcome Letter", "Retrieve the current class welcome letter template", ["teacher", "admin"]],
  ["classes.welcome_letter_update", "classes", "Update Welcome Letter", "Create or update the welcome letter template", ["teacher", "admin"]],
  ["classes.welcome_letter_delete", "classes", "Delete Welcome Letter", "Remove the welcome letter template", ["teacher", "admin"]],
  ["classes.dashboard", "classes", "Teacher Dashboard", "Aggregated dashboard data for the teacher overview", ["teacher", "admin"]],

  // -- Reports --
  ["reports.academic_kpi", "reports", "Academic KPI Report", "Academic performance KPIs across students and classes", ["teacher", "admin"]],
  ["reports.grant_kpi", "reports", "Grant KPI Report", "Grant-related performance KPIs for SPOKES funding compliance", ["teacher", "admin"]],
  ["reports.grant_kpi_history", "reports", "Grant KPI History", "Historical grant KPI trends over time", ["teacher", "admin"]],
  ["reports.grant_kpi_students", "reports", "Grant KPI Student Detail", "Per-student detail for grant KPI metrics", ["teacher", "admin"]],
  ["reports.outcomes", "reports", "Outcomes Report", "Student outcomes data (employment, credentials, completion)", ["teacher", "admin"]],
  ["reports.readiness", "reports", "Readiness Report", "Monthly career-readiness scores for all students", ["teacher", "admin"]],
  ["reports.spokes", "reports", "SPOKES Report", "Aggregate SPOKES module completion and attendance data", ["teacher", "admin"]],
  ["reports.intervention_queue", "reports", "Intervention Queue", "Priority-ranked list of students needing teacher intervention", ["teacher", "admin"]],

  // -- Admin --
  ["admin.audit_trail", "admin", "Audit Trail", "View the full audit log of all system actions", ["admin"]],
  ["admin.student_detail", "admin", "Student Detail", "View comprehensive student profile data", ["teacher", "admin"]],
  ["admin.student_status_update", "admin", "Update Student Status", "Change a student account status (active, inactive, suspended)", ["teacher", "admin"]],
  ["admin.student_archive", "admin", "Archive Student", "Archive a student record and related data", ["teacher", "admin"]],
  ["admin.student_archive_check", "admin", "Check Archive Status", "Verify whether a student has been archived", ["teacher", "admin"]],
  ["admin.student_export", "admin", "Student Data Export", "Export student data in CSV/JSON for grant reporting", ["teacher", "admin"]],
  ["admin.student_usage", "admin", "Student AI Usage", "View AI token usage stats for a specific student", ["teacher", "admin"]],
  ["admin.student_mood", "admin", "Student Mood History", "Teacher views mood tracking history for a student", ["teacher", "admin"]],
  ["admin.student_notes_list", "admin", "Student Notes", "View advisor notes for a specific student", ["teacher", "admin"]],
  ["admin.student_notes_create", "admin", "Create Student Note", "Add an advisor note about a student", ["teacher", "admin"]],
  ["admin.student_notes_update", "admin", "Update Student Note", "Edit an existing advisor note", ["teacher", "admin"]],
  ["admin.student_notes_delete", "admin", "Delete Student Note", "Remove an advisor note", ["teacher", "admin"]],
  ["admin.student_reset_password", "admin", "Reset Student Password", "Teacher resets a student password on their behalf", ["teacher", "admin"]],
  ["admin.student_forms", "admin", "Student Forms", "Teacher views form completion status for a student", ["teacher", "admin"]],
  ["admin.student_forms_update", "admin", "Update Student Form Status", "Teacher updates form review status for a student", ["teacher", "admin"]],
  ["admin.webhooks_list", "admin", "List Webhooks", "View all configured webhook subscriptions", ["admin"]],
  ["admin.webhooks_create", "admin", "Create Webhook", "Register a new webhook subscription", ["admin"]],
  ["admin.webhooks_update", "admin", "Update Webhook", "Modify an existing webhook subscription", ["admin"]],
  ["admin.webhooks_delete", "admin", "Delete Webhook", "Remove a webhook subscription", ["admin"]],
  ["admin.ai_config_get", "admin", "Get AI Config", "View current AI model configuration and API key status", ["admin"]],
  ["admin.ai_config_update", "admin", "Update AI Config", "Modify AI model settings (model name, temperature, etc.)", ["admin"]],
  ["admin.ai_config_delete", "admin", "Delete AI Config Override", "Remove custom AI config and revert to defaults", ["admin"]],
  ["admin.ai_config_test", "admin", "Test AI Config", "Send a test prompt to verify AI configuration works", ["admin"]],
  ["admin.settings_api_key_get", "admin", "Get API Key Status", "Check whether a personal API key is configured", ["student", "teacher", "admin"]],
  ["admin.settings_api_key_set", "admin", "Set API Key", "Store a personal Gemini API key for enhanced AI access", ["student", "teacher", "admin"]],
  ["admin.settings_api_key_delete", "admin", "Delete API Key", "Remove a stored personal API key", ["student", "teacher", "admin"]],
  ["admin.settings_credly_get", "admin", "Get Credly Settings", "View Credly integration configuration", ["student"]],
  ["admin.settings_credly_set", "admin", "Set Credly Username", "Configure Credly username for badge syncing", ["student"]],
  ["admin.settings_credly_delete", "admin", "Delete Credly Settings", "Remove Credly integration configuration", ["student"]],

  // -- SPOKES --
  ["spokes.record", "spokes", "Student SPOKES Record", "View SPOKES module progress and attendance for a student", ["teacher", "admin"]],
  ["spokes.record_update", "spokes", "Update SPOKES Record", "Update a student SPOKES attendance or module status", ["teacher", "admin"]],
  ["spokes.checklist", "spokes", "SPOKES Checklist", "Update module checklist completion for a student", ["teacher", "admin"]],
  ["spokes.modules_complete", "spokes", "Complete SPOKES Module", "Mark a SPOKES module as completed for a student", ["teacher", "admin"]],
  ["spokes.modules_reopen", "spokes", "Reopen SPOKES Module", "Revert a completed SPOKES module to in-progress", ["teacher", "admin"]],
  ["spokes.follow_up_create", "spokes", "Create Follow-Up", "Schedule a follow-up action for a student SPOKES module", ["teacher", "admin"]],
  ["spokes.follow_up_delete", "spokes", "Delete Follow-Up", "Remove a scheduled SPOKES follow-up action", ["teacher", "admin"]],
  ["spokes.config_list", "spokes", "SPOKES Config", "View SPOKES module configuration and templates", ["teacher", "admin"]],
  ["spokes.config_create", "spokes", "Create SPOKES Config", "Add a new SPOKES module configuration", ["teacher", "admin"]],
  ["spokes.config_update", "spokes", "Update SPOKES Config", "Modify an existing SPOKES module configuration", ["teacher", "admin"]],
  ["spokes.config_delete", "spokes", "Delete SPOKES Config", "Remove a SPOKES module configuration", ["teacher", "admin"]],
  ["spokes.referrals_list", "spokes", "List Referrals", "View SPOKES referrals and external service connections", ["teacher", "admin"]],
  ["spokes.referrals_create", "spokes", "Create Referral", "Create a new SPOKES external service referral", ["teacher", "admin"]],
  ["spokes.referrals_delete", "spokes", "Delete Referral", "Remove a SPOKES referral record", ["teacher", "admin"]],
] as const;

// ---------------------------------------------------------------------------
// 3. Main
// ---------------------------------------------------------------------------

async function main() {
  // Upsert system roles
  for (const role of SYSTEM_ROLES) {
    await prisma.role.upsert({
      where: { name: role.name },
      update: {
        displayName: role.displayName,
        hierarchyLevel: role.hierarchyLevel,
        description: role.description,
      },
      create: role,
    });
  }

  // Upsert permissions
  for (const [key, namespace, displayName, description] of PERMISSION_SEEDS) {
    await prisma.permission.upsert({
      where: { key },
      update: { namespace, displayName, description },
      create: { key, namespace, displayName, description },
    });
  }

  // Build lookup maps
  const allRoles = await prisma.role.findMany();
  const allPerms = await prisma.permission.findMany();
  const roleMap = new Map(allRoles.map((r) => [r.name, r.id]));
  const permMap = new Map(allPerms.map((p) => [p.key, p.id]));

  // Upsert role-permission mappings
  let mappingCount = 0;
  for (const [key, , , , allowedRoles] of PERMISSION_SEEDS) {
    const permissionId = permMap.get(key);
    if (!permissionId) continue;

    for (const roleName of allowedRoles) {
      const roleId = roleMap.get(roleName);
      if (!roleId) continue;

      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId, permissionId } },
        update: { granted: true },
        create: { roleId, permissionId, granted: true },
      });
      mappingCount++;
    }
  }

  const permCount = PERMISSION_SEEDS.length;
  console.log(
    `RBAC seed complete: ${allRoles.length} roles, ${permCount} permissions, ${mappingCount} role-permission mappings`,
  );
}

main()
  .catch((err: unknown) => {
    console.error("RBAC seed failed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
