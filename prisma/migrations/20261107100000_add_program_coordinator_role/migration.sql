-- Program coordinator: a state-wide, read-only role above the regional coordinator.
-- Same shape as the baseline's coordinator role and permission inserts.

INSERT INTO "visionquest"."Role"
  ("id", "name", "displayName", "hierarchyLevel", "description", "isSystem", "createdAt")
VALUES
  (
    'sys_program_coordinator_role_v1',
    'program_coordinator',
    'Program Coordinator',
    1,
    'Sees every region and class in the state; reads results and reports.',
    true,
    NOW()
  )
ON CONFLICT DO NOTHING;

INSERT INTO "visionquest"."RolePermission" ("id", "roleId", "permissionId", "granted")
SELECT
  'sys_rp_program_coordinator_' || substr(p."id", 10),
  'sys_program_coordinator_role_v1',
  p."id",
  true
FROM "visionquest"."Permission" p
WHERE p."namespace" = 'coordinator'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;
