# Presigned Download URLs Runbook

**Context:** Phase 2 of [supabase-optimization.md](./supabase-optimization.md).
Replaces server-proxied file downloads with S3 presigned URLs.

## What changed

Four routes now consult `getPresignedDownloadUrl()` before falling back to
the buffered `downloadFile()` path:

- `GET /api/files/download` — student file uploads
- `GET /api/documents/download` — program documents (view/download modes)
- `GET /api/forms/download` — SPOKES forms
- `GET /api/teacher/students/[id]/archive` — per-student ZIP archives (the
  highest-impact route — 50–100MB files no longer buffer through Node.js)

When the feature flag is enabled and storage is configured, the route
returns an HTTP 302 redirect to a 1-hour presigned URL. Otherwise it falls
back to the existing buffer path (so local dev and non-S3 environments are
unaffected).

## Rollout

The feature is gated behind `USE_PRESIGNED_URLS`. It is disabled by default.

### 1. Verify the bucket is private

Supabase Dashboard → **Storage → Buckets**. The app's bucket must be
**Private** (not Public). Presigned URLs are the access control — public
buckets undermine the security model.

While you're there, confirm:

- Max file size: 10 MB
- Allowed MIME types: `application/pdf`, `image/jpeg`, `image/png`, `image/gif`

### 2. Enable the flag on Render

Render Dashboard → **Web Service → Environment** → add:

```
USE_PRESIGNED_URLS=true
```

Save and redeploy.

### 3. Smoke test each route

After redeploy, exercise each download path and verify in browser devtools
that the response is `302` with a `Location: https://<bucket>.s3.<region>...`
header, followed by a `200` from the presigned URL.

1. **Student file** — as a student, click a file in Files. Response should
   be 302 → presigned URL → file.
2. **Program document** — as a student, click "View" on a program doc.
   Try "Download" as well. Both should 302 → presigned URL.
3. **SPOKES form** — as a student, open a form from the Forms Hub.
4. **Teacher archive** — as a teacher, generate and download a student
   archive. Confirm the ZIP arrives intact and the response bypasses
   Node.js memory (check Render metrics: no RSS spike on large archives).

## Rollback

If presigned URLs are broken for any reason, set
`USE_PRESIGNED_URLS=false` (or remove the env var) and redeploy. Routes
will fall back to the buffered path — same behavior as before this phase.

## Verification queries

None needed — this phase has no DB migration.

## Operational notes

- **URL expiry:** 1 hour. If a user loads a page and sits on it for longer
  than an hour before clicking, their link will fail with 403 SignatureExpired.
  Browsers typically re-request the route handler (cheap — just re-signs).
- **Content-Disposition:** the presigned URL includes `response-content-disposition`
  so the browser still gets the correct `inline` vs `attachment` behavior
  and a sensible filename, even though the bytes come directly from S3.
- **Uploads and deletes:** unchanged. Still server-mediated via the
  existing PutObject / DeleteObject paths. This phase only covers reads.
- **Bundled content fallback:** `downloadFile()` has a fallback path for
  files in `docs-upload/` and `content/` directories. Those files aren't
  in object storage, so `getPresignedDownloadUrl()` would 404. The route's
  fallback branch handles this transparently.
