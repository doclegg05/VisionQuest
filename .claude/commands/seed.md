# /project:seed

Seed the database with orientation items, cert templates, SPOKES checklists, and program documents.

## Steps
1. Confirm `DATABASE_URL` is set (check `.env.local`)
2. Run `npx prisma generate` if client is stale
3. Run `node scripts/seed-data.mjs` — upserts:
   - 10 orientation items (SPOKES orientation checklist)
   - Cert templates (Ready to Work requirements)
   - 100+ SPOKES checklist templates (from official 6/13/2025 checklist)
   - SPOKES module templates
4. Run `node scripts/seed-documents.mjs` — seeds program documents from `docs-upload/`
5. Report counts: orientation items, cert templates, checklist templates, documents seeded
