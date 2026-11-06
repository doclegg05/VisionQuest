-- Sage chat for both coordinator roles (owner decision, 2026-11-06).
--
-- The sage.* Permission rows come from scripts/seed-rbac.ts, not from a
-- migration, so their ids are whatever the seed generated. This grant looks
-- them up by key. In a database the seed never ran on, the SELECT finds no
-- permission and inserts nothing; the registry's static requiredRoles then
-- admit both roles (src/lib/registry/tools.ts).
--
-- Once any RolePermission row maps sage.chat, RBAC answers for every role,
-- so without these rows a seeded database refuses coordinators with a 403.
--
-- Chat and its two read routes only. tool-confirm and the chat upload stay
-- closed to coordinators in the routes themselves.
--
-- Roles are matched by name, the column rbac.ts reads. Row ids are
-- deterministic, in the baseline's sys_rp_<role>_ style. Idempotent.

INSERT INTO "visionquest"."RolePermission" ("id", "roleId", "permissionId", "granted")
SELECT
  'sys_rp_' || r."name" || '_' || replace(p."key", '.', '_'),
  r."id",
  p."id",
  true
FROM "visionquest"."Permission" p
CROSS JOIN "visionquest"."Role" r
WHERE p."key" IN ('sage.chat', 'sage.conversations', 'sage.history')
  AND r."name" IN ('coordinator', 'program_coordinator')
ON CONFLICT DO NOTHING;
