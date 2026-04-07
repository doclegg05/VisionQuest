# Prisma Conventions

## Schema
- All models use `visionquest` PostgreSQL schema (`@@schema("visionquest")`)
- Always add `@default(cuid())` for `id` fields
- Timestamps: `createdAt DateTime @default(now())`, `updatedAt DateTime @updatedAt` on every model
- Use enums sparingly — prefer string unions stored as `String` when values change frequently
- Cascade deletes: explicit `onDelete: Cascade` on child relations (goals, messages, progress records)

## Queries
- All Prisma queries go in `src/lib/` helper modules — never directly in route handlers
- Always scope student data with `where: { studentId }` — never return other students' data
- Use `select` or `include` to limit returned fields — no `findMany()` without filtering
- Avoid N+1: use `include` for related data rather than sequential queries
- Use transactions (`prisma.$transaction`) for multi-step writes (e.g., complete cert + award XP)

## Migrations
- Run `npx prisma validate` after every schema edit
- Migration names should be descriptive: `add_career_discovery`, not `update_schema`
- Review generated SQL before committing — check for unintended DROP statements
- Migrations run automatically on Render deploy via `prisma:migrate:deploy`

## Types
- Import types from `@prisma/client` — never redefine Prisma model types manually
- Use `Prisma.StudentGetPayload<{ include: {...} }>` for complex return types
- Keep `npx prisma generate` in sync after schema changes
