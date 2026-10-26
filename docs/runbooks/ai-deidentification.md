# AI de-identification at the provider boundary

**Status:** live. Applied automatically to every CLOUD provider resolution whose
sensitivity is `student_record` or `staff_entered`.
**Kill switch:** SystemConfig `ai_deidentify_cloud` / env `AI_DEIDENTIFY_CLOUD` — `"off"` disables it;
anything else, including unset, leaves it ON.
**Design:** `docs/audits/2026-09-06-ferpa-pii-review.md` §5, memo B §2.

## What it is

`resolveAiProvider` wraps the resolved cloud provider in a decorator
(`src/lib/ai/with-deidentification.ts`) built around a per-request `TokenVault`
(`src/lib/ai/deidentify.ts`). On the way out, values the app knows about are
replaced with loud placeholder tokens. On the way back in, only the tokens that
same vault issued are restored — including across streamed chunks, so a token
split as `[STU` / `DENT_NA` / `ME]` still comes back as the student's name, and
the transcript saved to `Message` is byte-for-byte what the student saw.

It lives inside the resolver, not at the call sites, so **a call site cannot
forget it**. That is the point: the failure mode this repo keeps hitting is a
control that exists and is never invoked.

## What is substituted

Structured, from `loadIdentityInput` (`src/lib/ai/identity.ts`, reading only what
the caller's own RLS context can see):

| Token | Value |
|---|---|
| `[STUDENT_NAME]` | `Student.displayName` (whole name, and any part other than the given name) |
| `[STUDENT_FIRST_NAME]` | the given name, so Sage's "Hey \<name\>" comes back as the first name |
| `[STUDENT_EMAIL]` | `Student.email` |
| `[STUDENT_LOGIN]` | `Student.studentId` — the login username, an identifier (F12) |
| `[STUDENT_PHONE]` | the SMS destination on `NotificationPreference` |
| `[TEACHER_NAME_n]` | staff names the request carries |
| `[PERSON_n]` | the managed roster, on a staff turn |

Detected in free text, whoever typed it:

| Token | Family |
|---|---|
| `[EMAIL_n]` | email addresses |
| `[PHONE_n]` | phone numbers |
| `[DOB_n]` | dates of birth (numeric and month-name forms carrying a day AND a year) |
| `[ADDRESS_n]` | US street addresses |

Never substituted: the values in `src/lib/ai/deidentify-allowlist.ts` — the 988
crisis line, its 1-800 alias, the Crisis Text Line short code. A tokenized crisis
number that failed to re-hydrate would be a safety regression, not a privacy win.

## Three honest limits

Copied from the review's §5.3, because the wording matters more than the feature:

1. **This is not de-identification.** It manages disclosure risk; it does not
   eliminate it. A closed population of 100–500 students in one West Virginia
   program is the worst case: employer plus town plus certification track plus
   approximate age singles someone out with no name present, and per-turn
   redaction does not compose into per-conversation safety.
2. **Third-party names cannot be caught.** The app knows every name in the
   cohort and nothing else. "my son Jayden", "my caseworker Brenda" pass
   through, and no NER library within reach closes that without costing more
   latency than the cloud lane is trying to save (memo B §2.b).
3. **Document bytes are not touched.** `describeDocument` sends a PDF or image
   as bytes; the prompt and the reply go through the vault, the file does not.

**The sentence to use externally is "reduced disclosure of identifiers under a
data-processing agreement." Never "de-identified."** Anyone who says the second
thing about a chat transcript is wrong.

## Where else it runs

**Memory write time** (`src/lib/sage/memory/store.ts`). A memory row is replayed
into every future prompt on whichever provider is configured that day, so its
content is pseudonymised *before* the source hash, the embedding and the insert,
and **permanently** — there is no vault at read time to reverse it. Consequences
to expect:

- Stored memories read `[STUDENT_NAME] wants a CNA job by December`.
- On a **cloud** turn the request's own vault re-hydrates that token if the model
  echoes it, so the student sees their name.
- On a **local** turn there is no vault, so a model that echoes the token
  verbatim shows the student `[STUDENT_NAME]`. Loud, not silent, and the correct
  direction — but it is a visible behaviour, not a hypothetical.
- On a **cloud** turn the recalled memory reaches the model as
  `(STUDENT_NAME) wants a CNA job` — the decorator neutralises every token shape
  in text the model is shown, including stored rows, so a forged token can
  never re-hydrate. The system prompt still carries the real display name
  separately, so greetings are unaffected.
- **Rows stored before this shipped** hold the raw name. Their hash does not
  match the pseudonymised twin a later turn extracts, so the pair can
  double-store until `scripts/memory-pseudonymize-backfill.mjs` (dry-run by
  default) rewrites the legacy rows.

**Evals.** `--deidentify=<name>[,<name>…]` on any script resolving through
`scripts/lib/sage-eval-provider.mjs` puts the same decorator in front of the eval
provider; `sage-evals.yml` passes `--deidentify=Sam,Ms. Lee` to the red-team and
tool-selection evals so the gate measures the shipped configuration.

## Audit trail

Every wrapped resolution writes an `ai.request.routed` AuditLog row at route
`ai.resolve` with `metadata.deidentified = true` and `metadata.tokens` — the
token **names**, never their values. Two consequences worth knowing:

- Turning the switch off makes those rows stop appearing. That is how you check
  which mode production is in.
- These rows are additional to the `routed`/`completed` events each caller
  already writes, so `sage:ai:accountability`'s "other → routed" count rises
  when de-identification is on.

## Operating it

**Check the current mode**

```sql
SELECT value FROM visionquest."SystemConfig" WHERE key = 'ai_deidentify_cloud';
-- no row, or anything other than 'off' → ON
```

**Turn it off** (only to reproduce a model problem against the raw prompt):

```sql
INSERT INTO visionquest."SystemConfig" (id, key, value, "createdAt", "updatedAt")
VALUES (gen_random_uuid()::text, 'ai_deidentify_cloud', 'off', now(), now())
ON CONFLICT (key) DO UPDATE SET value = 'off', "updatedAt" = now();
```

Turn it back on by deleting the row or setting any other value. It takes effect
on the next resolution — no deploy, and the SystemConfig cache TTL is the only
delay.

**Symptoms and what they mean**

| Symptom | Cause |
|---|---|
| A student sees `[STUDENT_NAME]` in a reply | Re-hydration missed, or the token came from a stored memory on a local turn. Loud by design — check which. |
| `metadata.tokens` is short or the row is absent | The identity loader found little or nothing (RLS refused a read, or the row is gone). Fail-open: the call still went out, unwrapped. |
| Sage stops using the student's name at all | The model declined to echo an obviously synthetic token. Measure with `sage:quality:eval`; the review flagged placeholder-dense prompts as a known reasoning cost. |

## Backfill

`scripts/memory-pseudonymize-backfill.mjs` (`npm run memory:pseudonymize:backfill`)
rewrites `SageMemory` rows written before store.ts's write-time pseudonymization
pass shipped. A legacy row holds the raw name; its `sourceHash` was computed
over that raw text, so it no longer matches the pseudonymized version a later
turn extracts for the same fact, and the pair can double-store instead of
deduping. Per active row (`subjectType: "student"`, `validTo: null`) the
script builds the same `TokenVault` `store.ts` builds at write time from that
student's own identity fields (display name, email, login id, SMS
destination — the same four `loadIdentityInput` vaults, read through
`prismaAdmin` rather than the RLS app client, since the script has no
session to run `loadIdentityInput` under) and re-runs `pseudonymize()`
against the stored content:

- **Unchanged** — the pseudonymized text is identical to what is stored
  (nothing to catch, including a row that is already pseudonymized).
- **Rewrite** — the text changes and no other active row for that student
  lands on the same final content: `content` and `sourceHash` are updated
  and the row is re-embedded so its vector matches the new text.
- **Dedupe** — two rows land on the same final content (the double-store the
  write-time pass was meant to prevent): the OLDER row is deleted and the
  newer one is kept, rewritten if it still needs it.

Dry run by default — it prints aggregate counts only (students scanned, rows
rewritten, deduped, unchanged) and never a name or a content string. `--apply`
performs the writes; `--student=<cuid>` scopes the run to one student;
`--limit=N` bounds how many students a run scans. Like the nudge runner and
the SMS inbound webhook, it refuses to run at all — dry run included — unless
`adminClientIsPrivileged()` confirms `ADMIN_DATABASE_URL` actually bypasses
RLS: under `vq_app` with no session context a cross-student read returns zero
rows, which would otherwise print "nothing to pseudonymize" when the real
answer is "this connection cannot see any rows at all."

What it cannot catch: the same residual the write-time pass cannot catch
either — a third party named in passing ("her son Jayden"), because the vault
only knows the acting student's own identity fields.

## Not covered here

Homoglyph and fullwidth look-alikes of the tokens; the identity vault (review
§5.4, decision D-K); the contract lane; and the résumé contact-block split,
which is a separate change because there the identifiers *are* the deliverable.
