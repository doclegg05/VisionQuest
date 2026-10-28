# Private preview signature repair — verified locally

**Current URL: https://127.0.0.1:61850** (2026-09-10). Reload using this URL, not the former port 56213. Normal login and existing private credentials remain unchanged. Developer-only synthetic macOS preview; not production/pilot approval. Independent review pending.

## Diagnosis and changes

Sanitized actual standalone diagnostic: `Signature submission error` with S3 XML deserialization failure (`char 'S' is not expected`). The worker's deliberately empty fixture returned plain-text 503 on PUT. No user's drawn signature was inspected, copied or reused.

- Replaced only the preview worker fixture with `scripts/developer-preview-storage.mjs`: persistent private local objects, real SDK PUT/GET/HEAD/DELETE, SigV4 HMAC authentication including body SHA-256, signed required headers and five-minute clock window, known bucket only, exact loopback host, XML errors, 10 MiB request limit, bounded headers/timeouts/connections. Anonymous reads are denied.
- Objects and MIME metadata persist atomically in a single envelope under owner-private `.developer-preview/objects/`. Request paths are validated then hashed into flat filenames. No request-controlled filesystem subdirectories; symlink directories/files (including dangling leaf symlinks) are rejected; opens use O_NOFOLLOW; files 0600, directories 0700. This remains a trusted-developer environment, not protection against hostile same-UID processes.
- Existing AWS SDK protocol remains in use. Only the worker's child environment sets `AWS_REQUEST_CHECKSUM_CALCULATION=WHEN_REQUIRED` and `AWS_RESPONSE_CHECKSUM_VALIDATION=WHEN_REQUIRED`. Buffer uploads use non-streaming signed SHA-256 bodies. Unsupported aws-chunked/trailer/optional-checksum requests fail explicitly rather than persisting wire framing as document bytes. No production storage configuration changed, no cloud fallback, no presigned/public object routes enabled.
- Normal file ownership and app RLS remain enforced. During ownership coverage, closed the signature endpoint's supplied-`fileId` ownership gap before any storage write; added a scoped route regression. No new preauth grants were needed. No rate-limit rows or policies were changed.
- Parent's `src/components/ui/SignaturePad.tsx` fingerprint was confirmed changed before the first rebuild. Its UI changes were included and not edited by this backend work.

## Actual verification

- Real S3 SDK test PASS: upload, HEAD size, GET exact PDF bytes and MIME, restart and reread, DELETE/404; foreign bucket, missing/incorrect authentication, malformed escape, encoded traversal, oversized body, aws-chunked, unsupported checksum and symlink reads/writes rejected.
- Existing ten preview lifecycle/safety tests PASS; new storage test PASS.
- `scripts/developer-preview-signatures.mjs` PASS using normal login and only `preview-second`'s previously unsatisfied rights/responsibilities form. It refuses initial execution if a submission already exists. Primary `preview-student` was used only to check denied access, never to change progress.
- Generated synthetic PNG and PDF only. Uploaded the PDF through `/api/files`, submitted PNG signature through `/api/forms/sign` with the owned PDF file ID, fetched exact persisted bytes through authenticated `/api/files/download`, and reread `/api/forms/status`. Foreign student downloads return 404, foreign target/file signature submissions return 403, anonymous download returns 401.
- Submitted the separate normal orientation completion action, then checked `completed: true` on the rights/responsibilities item. Actual stop/start retained the same DB, credentials, objects, submission and completion; normal-login HTTP `--verify` passed again after restart at the current URL.
- **Important distinction:** the existing read-and-sign UI/API saves a PNG signature, not an automatically stamped official PDF. The regression PDF is explicitly labelled synthetic and is uploaded using the normal file API. This repair does not manufacture a signed official document or change requirements/instructor verification rules. A pending form submission is not instructor approval or full orientation completion.
- Private snapshot production rebuild, TypeScript `tsc --noEmit`, scoped signature route tests, and final source/process/role `preview:check`: PASS. No screenshots were taken for this backend work.

## Evidence / repeat safely

Private (do not publish wholesale): `.developer-preview/signature-evidence.json`, `logs/signature-integration.log`, `logs/signature-route-tests.log`, `logs/signature-typecheck.log`, and `logs/build.log`.

```sh
node --test scripts/developer-preview-storage.test.mjs scripts/developer-preview.test.mjs
node scripts/developer-preview-signatures.mjs --verify
npm run preview:check
```

`--verify` checks the existing test-owned artifacts without replacing a signature. The initial runner is intentionally not rerunnable against an already satisfied form. Requests disable redirects; the runner re-executes in the local-only OS network sandbox with a sanitized environment before reading credentials and proves remote-denial. Avoid repeated normal logins that consume the unchanged rate policy.

## Final bounded integrity follow-up

Reviewer found no new storage blockers but identified invalid-image acceptance and missing integrity/failure test coverage. Both follow-ups are implemented:

- `/api/forms/sign` now rejects empty/noncanonical base64 and invalid PNGs before uploading or persisting. The existing 500,000-byte limit remains; Sharp performs a full pixel decode with `failOn: warning`, a 4-megapixel input limit, maximum 4096 pixels per side, and a single-page PNG requirement. An explicit terminal IEND check rejects truncation that libvips tolerates after complete pixel data. No signer identity, handwriting or consent is invented; image validity does not purport to authenticate handwriting.
- Ten scoped route tests PASS with a Sharp-generated valid synthetic PNG, empty/garbage/malformed base64, truncated pixels/missing or partial IEND, disguised JPEG, excessive dimensions/pixels/bytes, ownership, and write-failure coverage. Invalid inputs produce 400 and zero storage/database writes.
- Storage regressions now include an independently signed valid control, wrong signing secret (403 SignatureDoesNotMatch), a ten-minute-old signature (403 RequestTimeTooSkewed), bytes altered after signing (400 XAmzContentSHA256Mismatch), and a real test-only filesystem permission failure. The failed overwrite preserves prior bytes and MIME metadata. No runtime fault-injection or auth bypass was added.
- Rebuilt/restarted exactly once for this follow-up. Post-rebuild normal-login `--verify` reread only the existing test-owned signature/PDF/completion and checked ownership at **https://127.0.0.1:61850**; PASS. Existing user/test signatures were not overwritten, and no rate-limit counters were cleared.
- Final private snapshot typecheck, ten scoped signature tests, scoped API/test lint and current-source `preview:check`: PASS. Private logs: `signature-integrity-{typecheck,tests,lint}.log`; existing `signature-evidence.json` reflects the new URL. Parent's UI work was retained; no additional browser contrast check was performed in this backend follow-up. Final follow-up re-review is not claimed.

No production credentials, dotenv files, databases or provider network access were used. Existing developer progress and unrelated source work were preserved.
