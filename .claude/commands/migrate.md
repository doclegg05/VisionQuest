# /project:migrate

Create and apply a Prisma migration.

## Steps
1. Run `npx prisma validate` — schema must parse cleanly
2. Run `npx prisma generate` — regenerate client from schema
3. Show a diff of `prisma/schema.prisma` changes since last commit
4. Run `npx prisma migrate dev --name <descriptive_name>` to create migration
5. Review the generated SQL in `prisma/migrations/<timestamp>_<name>/migration.sql`
6. Verify no destructive changes (DROP TABLE, DROP COLUMN) unless explicitly intended
7. Run `npm run typecheck` — new Prisma types should not break existing code
8. Remind: migration SQL is committed to git and runs on deploy via `prisma:migrate:deploy`
