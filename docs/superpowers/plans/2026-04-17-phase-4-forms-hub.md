# Phase 4 — Forms Hub

**Date:** 2026-04-17
**Goal:** A first-class forms system serving Student → Teacher → Coordinator. Define forms once, assign to students/cohorts, collect structured responses, export for grant reporting.
**Target branch:** `phase-4-forms` (off `main`; rebases onto prior phases)
**Depends on:** Phase 1 (programType), Phase 3 (program badges for template UI)
**Estimated duration:** 2 weeks

---

## Scope

**In:**
1. New schema for structured form templates + responses (JSON-schema-backed).
2. Form builder UI (teacher/admin) for authoring templates.
3. Assignment mechanism: assign template to a student or to a class cohort.
4. Student fill-out experience integrated into Dashboard ("Assigned Forms" module).
5. `/forms` page for students (all assigned + optional forms; no new nav entry — reached via Dashboard link).
6. Teacher review UI: per-template grid view and per-student detail (extend existing StudentDetail "Submitted Forms" section).
7. CSV export per template for Coordinator grant reporting.

**Out:**
- Full BI/pivoting (use CSV + Excel for now)
- Replacing the existing `FormSubmission` PDF-upload pipeline — structured forms live alongside, not instead of (DOHS forms and signed legal forms keep the PDF workflow)
- Branching logic / conditional fields / calculated fields
- Multi-page forms (single-page MVP; can add paging in a later pass)
- Coordinator-specific dashboard (Phase 5; Phase 4 ships the CSV so Coordinator has data)

---

## Verified premises

| Claim | Evidence |
|---|---|
| Existing `FormSubmission` is document/PDF-centric with file-based storage | `prisma/schema.prisma:801-819` |
| `ProgramDocument` holds PDF form templates today | `prisma/schema.prisma:827-870` |
| `ProgramDocCategory` enum covers DOHS_FORM, ORIENTATION, etc. — preserve these for PDF forms | `prisma/schema.prisma:872-898` |
| StudentDetail has an existing "Submitted Forms" section | `src/components/teacher/student-detail/OperationsTab.tsx:118` |
| Student dashboard has inline action modules pattern | `src/app/(student)/dashboard/DashboardClient.tsx` (task list, appointment card) |
| Upload-backed form flow exists at `/api/forms/upload` and `/api/forms/sign` | `src/app/api/forms/upload/route.ts`, `.../sign/route.ts` |
| Secondary nav already has `/files`, `/resources`, `/vision-board` — no need to add a Forms entry | `src/lib/nav-items.ts:25-29` |

---

## Design decisions

### Decision 1 — Dual-track forms: structured alongside PDF, not instead of

Existing PDF pipeline (ProgramDocument template + FormSubmission upload + signature) serves DOHS-form and wet-signature use cases. **Keep it.** Add a structured track for data-reportable forms. Both tracks coexist and are visible in the same student-facing "Forms" view with a type indicator.

### Decision 2 — JSON schema for definition, JSON responses for answers

New tables `FormTemplate` and `FormResponse`. Template stores `schema: Json` (array of field definitions). Response stores `answers: Json` (field key → value map). Validation via Zod at API boundaries.

Rationale: flexibility for the form builder UI, no migration churn when fields change, simple export via JSON-to-CSV. Tradeoff: reporting queries scan JSON — acceptable at SPOKES scale (hundreds-to-low-thousands of responses per form).

### Decision 3 — Field types MVP: text, longText, number, date, select, multiselect, checkbox, attachment

Each field:
```ts
type FieldDef = {
  key: string;               // stable identifier
  label: string;
  type: FieldType;
  required: boolean;
  options?: string[];        // select/multiselect only
  helpText?: string;
  maxLength?: number;        // text/longText
};
```

Later-phase additions (not MVP): conditional, repeating group, calculated.

### Decision 4 — Program scoping on templates

```
FormTemplate.programTypes: string[]   // ["spokes"] | ["adult_ed"] | ["spokes","adult_ed"] | ...
```

Student-facing form list filters by the student's current program (derived via `getStudentProgramType`). Teacher-facing form list shows all. Empty array treated as "all programs."

### Decision 5 — Assignment: flexible targeting, explicit records

```
FormAssignment {
  id, templateId, assignedBy, dueAt?, requiredForCompletion: boolean,
  scope: "class" | "student",
  targetId: string,  // classId or studentId
  createdAt
}
```

On assignment:
- scope="class": create one assignment row; student-facing list expands at read time by joining via class enrollment. No row-per-student fan-out.
- scope="student": create one row targeting that student directly.

A student sees the union of (direct assignments) + (class-scope assignments via their active enrollments).

### Decision 6 — Discovery surface: Dashboard module, not new nav item

Student nav does NOT gain a "Forms" primary item. Instead:
- Dashboard shows an "Assigned Forms" card near the tasks card, with up-to-3 most-urgent entries.
- "See all forms" link goes to `/forms`.
- Secondary nav stays as-is (`/vision-board`, `/files`, `/resources`). Adding "Forms" here is **optional** — recommend skipping to avoid clutter; the Dashboard surface is where students already look for next actions.

Teacher side: "Forms" appears under `/teacher/manage` (Program Setup) as a section alongside curriculum/advising/events/certifications — matches existing pattern.

### Decision 7 — Review model: pending → reviewed → needs_changes

Status values on `FormResponse`:
- `draft` — student started, hasn't submitted
- `submitted` — student submitted, awaiting review
- `reviewed` — teacher marked complete
- `needs_changes` — teacher kicked back with notes; student can edit and resubmit

Existing PDF `FormSubmission.status` uses `pending` / other values — mirror the vocabulary but don't share the enum (keep the types independent so we don't over-couple the two tracks).

### Decision 8 — CSV export is simple and per-template

`GET /api/teacher/forms/[templateId]/export?from=...&to=...`
- Returns CSV with one row per response, columns = field keys + metadata (studentId, studentName, submittedAt, status, classId, programType).
- Admin/coordinator only.
- Filter by date range; default last 90 days.

No XLSX, no JSON export, no custom pivot builder in MVP.

### Decision 9 — Form builder: structured, not freeform

Teacher UI for authoring:
- Add field → type → label → required → (options if select) → save
- Reorder via drag-and-drop
- Preview pane shows student-facing rendering
- Save writes the `schema` JSON

No "advanced/raw JSON" editor in UI for MVP — keep the abstraction clean. Teachers who need raw JSON manipulation can hit the API directly.

### Decision 10 — Keep existing PDF pipeline untouched

Do NOT refactor `FormSubmission`, `/api/forms/upload`, `/api/forms/sign`. Phase 4 is purely additive. The existing StudentDetail "Submitted Forms" section (OperationsTab:118) remains for PDF submissions; structured responses get their own adjacent section.

---

## Schema migration

```prisma
model FormTemplate {
  id            String   @id @default(cuid())
  title         String
  description   String?  @db.Text
  programTypes  String[] @default([])       // empty = all programs
  schema        Json                         // array of FieldDef
  status        String   @default("active") // active | archived
  createdById   String?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  createdBy   Student?         @relation("CreatedFormTemplates", fields: [createdById], references: [id], onDelete: SetNull)
  assignments FormAssignment[]
  responses   FormResponse[]

  @@index([status, title])
  @@schema("visionquest")
}

model FormAssignment {
  id                      String    @id @default(cuid())
  templateId              String
  assignedById            String?
  scope                   String                        // "class" | "student"
  targetId                String                        // classId or studentId
  dueAt                   DateTime?
  requiredForCompletion   Boolean   @default(false)
  createdAt               DateTime  @default(now())

  template  FormTemplate @relation(fields: [templateId], references: [id], onDelete: Cascade)
  assignedBy Student?    @relation("CreatedFormAssignments", fields: [assignedById], references: [id], onDelete: SetNull)

  @@index([scope, targetId])
  @@index([templateId])
  @@schema("visionquest")
}

model FormResponse {
  id           String    @id @default(cuid())
  templateId   String
  studentId    String
  answers      Json                       // field key → value
  status       String    @default("draft") // draft | submitted | reviewed | needs_changes
  submittedAt  DateTime?
  reviewedById String?
  reviewedAt   DateTime?
  reviewerNotes String?  @db.Text
  createdAt    DateTime  @default(now())
  updatedAt    DateTime  @updatedAt

  template   FormTemplate @relation(fields: [templateId], references: [id], onDelete: Cascade)
  student    Student      @relation("FormResponses", fields: [studentId], references: [id], onDelete: Cascade)
  reviewedBy Student?     @relation("ReviewedFormResponses", fields: [reviewedById], references: [id], onDelete: SetNull)

  @@unique([templateId, studentId])     // one response per student per template
  @@index([studentId, status])
  @@index([templateId, status])
  @@schema("visionquest")
}
```

Matching `Student` relations:
```diff
 model Student {
   ...
+  createdFormTemplates    FormTemplate[]    @relation("CreatedFormTemplates")
+  createdFormAssignments  FormAssignment[]  @relation("CreatedFormAssignments")
+  formResponses           FormResponse[]    @relation("FormResponses")
+  reviewedFormResponses   FormResponse[]    @relation("ReviewedFormResponses")
```

Migration name: `add_forms_hub_structured_templates`

---

## API surface

### Teacher / Admin

- `POST /api/teacher/forms/templates` — create template
- `PATCH /api/teacher/forms/templates/[id]` — update/archive
- `GET /api/teacher/forms/templates` — list (with response counts)
- `GET /api/teacher/forms/templates/[id]` — detail + schema
- `POST /api/teacher/forms/templates/[id]/assign` — assign to class or student
- `DELETE /api/teacher/forms/assignments/[id]` — unassign
- `GET /api/teacher/forms/responses?templateId=...` — list responses for review
- `PATCH /api/teacher/forms/responses/[id]` — mark reviewed / needs_changes
- `GET /api/teacher/forms/[templateId]/export` — CSV download (admin/coordinator only)

### Student

- `GET /api/student/forms` — list assigned + open forms
- `GET /api/student/forms/[templateId]` — fetch schema + current response (draft if any)
- `PUT /api/student/forms/[templateId]` — upsert response (partial or full)
- `POST /api/student/forms/[templateId]/submit` — mark submitted

All routes: CSRF origin-checked, Zod-validated bodies, cross-student access denied.

---

## Code changes

### Student-facing

1. `src/app/(student)/forms/page.tsx` (new) — list view
2. `src/app/(student)/forms/[templateId]/page.tsx` (new) — fill view with save-as-draft
3. `src/components/student/AssignedFormsCard.tsx` (new) — Dashboard module
4. Update `src/app/(student)/dashboard/DashboardClient.tsx` to include the new card

### Teacher-facing

5. `src/components/teacher/forms/FormBuilder.tsx` (new) — authoring UI
6. `src/components/teacher/forms/FormTemplatesList.tsx` (new)
7. `src/components/teacher/forms/FormResponsesReview.tsx` (new)
8. Integrate into `ManageDashboard.tsx` (Program Setup) as a new "Forms" section
9. Add a structured-forms section to `OperationsTab.tsx` alongside the existing PDF "Submitted Forms" block

### Shared

10. `src/lib/forms/schema.ts` (new) — Zod definitions for `FieldDef`, `FieldResponse`, `FormTemplate schema JSON`
11. `src/lib/forms/assignment.ts` (new) — `listAssignedForms(studentId)` unions class + direct assignments
12. `src/lib/forms/export.ts` (new) — CSV generation (streaming for large exports)

### API

13. All routes above, in `src/app/api/teacher/forms/**` and `src/app/api/student/forms/**`

---

## Tests

Heavy coverage given the breadth of the feature:

- **Unit:** field-def Zod schema accepts valid types, rejects unknowns; required-field validation; CSV escaping (commas, quotes, newlines in answers)
- **Integration:** template create → assign to class → student response upsert → teacher review → CSV export — full happy path
- **Authorization:**
  - Student cannot see templates not assigned to them
  - Student cannot submit responses for another student
  - Student can only edit own draft/needs_changes responses
  - Teacher cannot see responses for students outside their managed classes
  - CSV export restricted to admin/coordinator
- **Edge cases:**
  - Assignment scope="class" with no active enrollments → student sees no form
  - Student archived after draft exists → response retained for audit
  - Template archived with in-flight drafts → drafts remain visible but read-only
  - Concurrent submit (student and teacher reviewing simultaneously) → last-write-wins on responses; review actions are idempotent

---

## UAT

1. Admin creates a "SPOKES Intake" template with 8 fields (text, date, select, longText, attachment).
2. Admin assigns template to a class of 4 students.
3. Log in as each student → Dashboard shows "Assigned Forms" card with the intake form.
4. Student fills out 3 fields, saves draft, logs out.
5. Student returns → draft persisted, can continue.
6. Student submits → status flips to `submitted`, disappears from "due" count.
7. Log in as teacher → new response visible in review grid.
8. Teacher marks one response `needs_changes` with notes.
9. That student's dashboard shows the form back in "due" list with reviewer notes visible.
10. Admin downloads CSV → one row per response, proper field columns, no leakage of draft data.

---

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| JSON schema drift — fields renamed after responses exist | Template versioning: on edit, create a new version; existing responses keep reference to old version. MVP skips full versioning; instead, lock field keys as immutable once published. |
| Large CSV exports hang the server | Stream response with cursor pagination; chunk size 500 rows. |
| Student abuses file-attachment field to upload giant files | Enforce existing FileUpload size/MIME limits (reuse `/api/files/upload` infra); don't invent new file storage. |
| Coordinator needs cross-program rollups | MVP: one CSV per template. Regional Coordinator dashboard in Phase 5 will consume these programmatically. |
| Forms created by teachers pollute admin/grant reports with low-quality data | Add `isOfficial: boolean` flag on templates; coordinator CSVs filter on `isOfficial=true` by default. |
| StudentDetail Operations tab gets even bigger (607 lines today) | Split the tab in Phase 6 (already planned) — don't preemptively refactor. Add structured-forms section in a separate file and compose. |

---

## Commit sequence

1. `feat(schema): add FormTemplate, FormAssignment, FormResponse`
2. `feat(lib): forms Zod schemas + assignment resolver`
3. `feat(api): teacher form-template CRUD`
4. `feat(api): student form fetch + upsert + submit`
5. `feat(teacher): form builder UI`
6. `feat(teacher): assign form to class or student`
7. `feat(student): Dashboard "Assigned Forms" card`
8. `feat(student): /forms list + fill pages`
9. `feat(teacher): response review grid + per-student view`
10. `feat(api): CSV export for admin/coordinator`
11. `test(forms): full coverage per test plan`

---

## Definition of done

- [ ] Structured form can be created, assigned, filled, reviewed, and exported end-to-end
- [ ] Existing PDF FormSubmission flow untouched and functional (regression verified)
- [ ] CSV export opens cleanly in Excel + Google Sheets with correct field columns
- [ ] All authorization paths enforced (tests green)
- [ ] Student dashboard shows assigned forms without requiring new nav item
- [ ] Full test suite + lint + prisma validate pass

---

## What this unlocks

- **Phase 5 (Coordinator dashboard)** consumes `FormResponse` data and CSV exports for grant reporting.
- **Teacher grant-metric reporting** stops living in spreadsheets outside the app.
- **Students** have a single predictable place for program paperwork (intake, assessments, evaluations).
- **Coordinator** can issue program-wide surveys without touching the codebase.
