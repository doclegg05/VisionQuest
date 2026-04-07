# Database Migration Skill

Automatically invoked when modifying `prisma/schema.prisma` or creating migrations.

## Pre-Migration Checklist
1. `npx prisma validate` — schema must parse before proceeding
2. Review the diff: what models/fields are added, changed, or removed?
3. Check for breaking changes:
   - Removing a column that existing code references
   - Changing a field from optional to required without a default
   - Renaming a model (Prisma treats this as drop + create)

## Migration Creation
1. Generate: `npx prisma migrate dev --name <descriptive_name>`
2. Review SQL: read `prisma/migrations/<timestamp>_<name>/migration.sql`
3. Red flags in generated SQL:
   - `DROP TABLE` or `DROP COLUMN` — data loss, needs explicit confirmation
   - `ALTER COLUMN ... SET NOT NULL` without `SET DEFAULT` — fails on existing NULLs
   - Missing `CREATE INDEX` for frequently queried foreign keys

## Post-Migration
1. `npx prisma generate` — regenerate client types
2. `npm run typecheck` — verify no type errors from schema changes
3. Update `src/lib/` helpers if query shapes changed
4. Update seed scripts if new required fields were added
5. Test locally before pushing — migration runs on Render deploy automatically

## Rollback Strategy
- Prisma doesn't auto-rollback. If a migration fails on deploy:
  1. Fix the schema and create a corrective migration
  2. Or mark the failed migration as resolved: `npx prisma migrate resolve --rolled-back <name>`
- Never manually edit migration SQL files after they've been committed

## Common Patterns in This Project
- New student-facing feature: add model + `studentId` FK with cascade delete
- New teacher feature: add model + `createdById` FK referencing Student (teacher role)
- New checklist/progress: template model + progress model with `@@unique([studentId, templateId])`
- XP integration: add `ProgressionEvent` entry type in progression engine after new completable action
