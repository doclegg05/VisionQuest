-- ===========================================================================
-- Enable RLS on All Remaining Tables
-- ===========================================================================
-- Triggered by: Supabase security warning — tables without RLS are accessible
-- via the PostgREST API to anyone with the anon/authenticated key.
--
-- Strategy: Enable RLS with NO additional policies for anon/authenticated.
-- This means:
--   - Supabase API access → DENIED (no matching policy = deny all)
--   - Prisma (postgres superuser) → UNAFFECTED (superuser bypasses RLS)
--
-- The app connects as postgres via Prisma. All tenant isolation is enforced
-- at the app layer via WHERE clauses (studentId ownership checks).
--
-- Future: Create a restricted vq_app role, wire Prisma client extension
-- to SET LOCAL GUCs per request, and connect as vq_app for defense-in-depth.
-- Policies for vq_app already exist (migration 20260403060000).
-- ===========================================================================

-- =========================================================================
-- CRITICAL: Student-data tables (PII, credentials, chat)
-- =========================================================================

-- Student — PII: email, passwordHash, mfaSecret, geminiApiKey
ALTER TABLE "visionquest"."Student" ENABLE ROW LEVEL SECURITY;

-- Conversation — chat session metadata
ALTER TABLE "visionquest"."Conversation" ENABLE ROW LEVEL SECURITY;

-- Message — full chat content with Sage
ALTER TABLE "visionquest"."Message" ENABLE ROW LEVEL SECURITY;

-- Goal — personal student goals
ALTER TABLE "visionquest"."Goal" ENABLE ROW LEVEL SECURITY;

-- PasswordResetToken — token hashes (account takeover risk)
ALTER TABLE "visionquest"."PasswordResetToken" ENABLE ROW LEVEL SECURITY;

-- SecurityQuestionAnswer — recovery answers
ALTER TABLE "visionquest"."SecurityQuestionAnswer" ENABLE ROW LEVEL SECURITY;

-- SystemConfig — encrypted API keys and system settings
ALTER TABLE "visionquest"."SystemConfig" ENABLE ROW LEVEL SECURITY;

-- =========================================================================
-- MEDIUM: Operational and internal tables
-- =========================================================================

-- AuditLog — who did what (sensitive operational data)
ALTER TABLE "visionquest"."AuditLog" ENABLE ROW LEVEL SECURITY;

-- LlmCallLog — AI API call records
ALTER TABLE "visionquest"."LlmCallLog" ENABLE ROW LEVEL SECURITY;

-- WebhookSubscription — external webhook URLs
ALTER TABLE "visionquest"."WebhookSubscription" ENABLE ROW LEVEL SECURITY;

-- ProgramDocument — RAG/document storage
ALTER TABLE "visionquest"."ProgramDocument" ENABLE ROW LEVEL SECURITY;

-- AdvisorAvailability — teacher schedule data
ALTER TABLE "visionquest"."AdvisorAvailability" ENABLE ROW LEVEL SECURITY;

-- =========================================================================
-- LOW: Reference, config, and template tables
-- =========================================================================

-- BackgroundJob — internal job queue
ALTER TABLE "visionquest"."BackgroundJob" ENABLE ROW LEVEL SECURITY;

-- OrientationItem — orientation template items
ALTER TABLE "visionquest"."OrientationItem" ENABLE ROW LEVEL SECURITY;

-- LmsLink — LMS course links
ALTER TABLE "visionquest"."LmsLink" ENABLE ROW LEVEL SECURITY;

-- SpokesChecklistTemplate — checklist templates
ALTER TABLE "visionquest"."SpokesChecklistTemplate" ENABLE ROW LEVEL SECURITY;

-- SpokesModuleTemplate — module templates
ALTER TABLE "visionquest"."SpokesModuleTemplate" ENABLE ROW LEVEL SECURITY;

-- CertTemplate — certification templates
ALTER TABLE "visionquest"."CertTemplate" ENABLE ROW LEVEL SECURITY;

-- SpokesClass — class definitions
ALTER TABLE "visionquest"."SpokesClass" ENABLE ROW LEVEL SECURITY;

-- SpokesClassInstructor — teacher-class mapping
ALTER TABLE "visionquest"."SpokesClassInstructor" ENABLE ROW LEVEL SECURITY;

-- Opportunity — career opportunities
ALTER TABLE "visionquest"."Opportunity" ENABLE ROW LEVEL SECURITY;

-- CareerEvent — career events
ALTER TABLE "visionquest"."CareerEvent" ENABLE ROW LEVEL SECURITY;

-- RateLimitEntry — rate limiting state
ALTER TABLE "visionquest"."RateLimitEntry" ENABLE ROW LEVEL SECURITY;

-- GrantKpiSnapshot — aggregate grant metrics
ALTER TABLE "visionquest"."GrantKpiSnapshot" ENABLE ROW LEVEL SECURITY;

-- SageSnippet — AI snippet cache
ALTER TABLE "visionquest"."SageSnippet" ENABLE ROW LEVEL SECURITY;

-- JobClassConfig — job board configuration
ALTER TABLE "visionquest"."JobClassConfig" ENABLE ROW LEVEL SECURITY;

-- JobListing — cached job listings
ALTER TABLE "visionquest"."JobListing" ENABLE ROW LEVEL SECURITY;

-- Pathway — learning pathways
ALTER TABLE "visionquest"."Pathway" ENABLE ROW LEVEL SECURITY;

-- ClassRequirement — class requirements
ALTER TABLE "visionquest"."ClassRequirement" ENABLE ROW LEVEL SECURITY;

-- RBAC tables
ALTER TABLE "visionquest"."Role" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "visionquest"."Permission" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "visionquest"."RolePermission" ENABLE ROW LEVEL SECURITY;
