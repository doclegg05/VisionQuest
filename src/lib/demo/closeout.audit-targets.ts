/**
 * Demo closeout (readiness H10): every AuditLog.targetType the app writes,
 * and what that row's targetId holds.
 *
 * The refusal `records_about_unmarked_people` does not read this list. It
 * reads the target id of every audit row a demo account wrote and refuses
 * unless the id is a planned account, a planned class or a row a delete step
 * removes (`recordsAboutOthers` in closeout.guards.ts). The list is here so a
 * reviewer can see what each type points at, and closeout.audit-targets.test.ts
 * fails when the app starts writing a type that is not on it.
 */

const NO_TARGET = "No target id: the registry writes null, so the closeout has nothing to check.";

export const AUDIT_TARGET_TYPES: Readonly<Record<string, string>> = {
  // A person or a class.
  student: "A Student id: the account the action was about.",
  class: "A SpokesClass id.",
  staff_invite: "A StaffInvite id.",
  region: "A Region id.",
  // A row that belongs to one student. Deleted with a demo student, kept for a real one.
  advisor_availability: "An AdvisorAvailability id.",
  appointment: "An Appointment id.",
  application: "An Application id.",
  cert_requirement: "A CertRequirement id.",
  certification: "A Certification id.",
  class_enrollment: "A StudentClassEnrollment id.",
  connection: "A Connection id.",
  consent_record: "A ConsentRecord id.",
  conversation: "A Conversation id.",
  failed_extraction: "A FailedExtraction id.",
  form_submission: "A FormSubmission id.",
  goal: "A Goal id.",
  orientation: "An OrientationProgress id, or no target id when a registry orientation tool writes it.",
  sage_conversation: "A Conversation id.",
  sage_insight: "A SageInsight id.",
  sage_memory: "A SageMemory id.",
  sage_operation: "A SageOperation id.",
  sage_panel: "A SagePanel id.",
  spokes_checklist_progress: "A SpokesChecklistProgress id.",
  spokes_employment_follow_up: "A SpokesEmploymentFollowUp id.",
  spokes_module_progress: "A SpokesModuleProgress id.",
  spokes_record: "A SpokesRecord id.",
  student_alert: "A StudentAlert id, from an instructor's resolve, dismiss, snooze or reopen.",
  task: "A StudentTask id.",
  StudentHiddenJob: "A StudentHiddenJob id.",
  // A class's own rows. Deleted with the demo class, kept for a real one.
  JobClassConfig: "A JobClassConfig id.",
  JobListing: "A JobListing id.",
  job_lead: "A JobLead id.",
  // Shared program content. Never deleted, so a demo account's row about one refuses.
  JobBrowseListing: "A JobBrowseListing id.",
  ai_compliance_report: "No row: a report run, with no target id or a fixed label.",
  ai_request: "An AI request id, not a row the closeout deletes.",
  cert_template: "A CertTemplate id.",
  connect_batch: "A batch id, not a row the closeout deletes.",
  connect_dohs_export: "An export id, not a row the closeout deletes.",
  employer: "An Employer id.",
  employer_contact: "An EmployerContact id.",
  event: "A CareerEvent id.",
  form_template: "A FormTemplate id.",
  lms_link: "An LmsLink id.",
  opportunity: "An Opportunity id.",
  orientation_item: "An OrientationItem id.",
  pathway: "A Pathway id.",
  program_document: "A ProgramDocument id.",
  sage_snippet: "A SageSnippet id.",
  spokes_checklist_template: "A SpokesChecklistTemplate id.",
  spokes_module_template: "A SpokesModuleTemplate id.",
  system_config: "A SystemConfig id or key.",
  webhook_subscription: "A WebhookSubscription id.",
  // The closeout's own record, written after the deletes, with no target id.
  demo: "No target id: the closeout's own audit row.",
  // Tool namespaces from src/lib/registry, written by the registry middleware.
  admin: NO_TARGET,
  advising: NO_TARGET,
  auth: NO_TARGET,
  career: NO_TARGET,
  certifications: NO_TARGET,
  classes: NO_TARGET,
  files: NO_TARGET,
  goals: NO_TARGET,
  learning: NO_TARGET,
  notifications: NO_TARGET,
  portfolio: NO_TARGET,
  progression: NO_TARGET,
  reports: NO_TARGET,
  sage: NO_TARGET,
  spokes: NO_TARGET,
};
