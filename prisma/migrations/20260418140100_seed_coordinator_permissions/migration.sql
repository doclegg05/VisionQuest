-- Phase 5 — Seed coordinator.* permissions and wire them to:
--   coordinator role (full set) — direct grants for Regional Coordinators
--   admin role          (full set) — admin is a superset by design
--
-- Sentinel IDs (sys_perm_coordinator_*) keep rows stable across environments.
-- Uses ON CONFLICT DO NOTHING so re-runs are idempotent and rolling out to
-- databases where a permission already exists does not fail the migration.

INSERT INTO "visionquest"."Permission" ("id", "key", "namespace", "displayName", "description", "createdAt")
VALUES
  ('sys_perm_coordinator_dashboard_view', 'coordinator.dashboard.view', 'coordinator',
   'View coordinator dashboard', 'Access the regional coordinator workspace.', NOW()),
  ('sys_perm_coordinator_class_view_region', 'coordinator.class.view.region', 'coordinator',
   'View classes in assigned regions', 'Read-only access to classes in regions the coordinator oversees.', NOW()),
  ('sys_perm_coordinator_student_view_region', 'coordinator.student.view.region', 'coordinator',
   'View student rollups in region', 'Aggregate student data (counts, metrics) for coordinator reporting — no individual student detail.', NOW()),
  ('sys_perm_coordinator_forms_export', 'coordinator.forms.export', 'coordinator',
   'Export form responses as CSV', 'Download structured form responses from assigned regions.', NOW()),
  ('sys_perm_coordinator_grant_view', 'coordinator.grant.view', 'coordinator',
   'View grant targets and progress', 'Read grant goals and derived actuals for assigned regions.', NOW()),
  ('sys_perm_coordinator_grant_edit', 'coordinator.grant.edit', 'coordinator',
   'Edit grant targets', 'Create and update grant goals for assigned regions. Actuals remain derived.', NOW()),
  ('sys_perm_coordinator_instructor_metrics_view', 'coordinator.instructor.metrics.view', 'coordinator',
   'View instructor metrics', 'Active-student counts, alert response time, cert pass rate, form completion rate per instructor.', NOW())
ON CONFLICT ("key") DO NOTHING;

-- Wire all coordinator.* permissions to the coordinator role.
INSERT INTO "visionquest"."RolePermission" ("id", "roleId", "permissionId", "granted")
SELECT
  'sys_rp_coordinator_' || substr(p."id", 10),
  'sys_coordinator_role_v1',
  p."id",
  true
FROM "visionquest"."Permission" p
WHERE p."namespace" = 'coordinator'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

-- Wire the same set to admin (admin is a superset).
-- Admin role id is looked up at apply time rather than assumed static; if no
-- admin role exists yet the insert is a no-op.
INSERT INTO "visionquest"."RolePermission" ("id", "roleId", "permissionId", "granted")
SELECT
  'sys_rp_admin_' || substr(p."id", 10),
  r."id",
  p."id",
  true
FROM "visionquest"."Permission" p
CROSS JOIN "visionquest"."Role" r
WHERE p."namespace" = 'coordinator' AND r."name" = 'admin'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;
