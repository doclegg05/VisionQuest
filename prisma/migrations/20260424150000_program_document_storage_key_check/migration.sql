-- Reject the specific broken storageKey shapes that an older seed variant
-- produced (see scripts/cleanup-broken-documents.mjs for the archaeology).
-- This is a NEGATIVE constraint on purpose — it blocks the known-bad
-- patterns without locking us out of adding new legitimate top-level
-- folders later.
--
--  banned:
--    'docs-upload/...'                         wrong prefix (full local path leaked through)
--    'teachers/...' without '/guides/' segment missing segment from FOLDER_MAP
--    'students/...' without '/resources/' seg  missing segment from FOLDER_MAP
--    'presentation/...' (singular)             should be 'presentations/...'
--    '_inventory.txt'                          the inventory file itself, never a real doc

ALTER TABLE "visionquest"."ProgramDocument"
  ADD CONSTRAINT "program_document_storage_key_shape"
  CHECK (
    "storageKey" NOT LIKE 'docs-upload/%'
    AND "storageKey" NOT LIKE 'presentation/%'
    AND "storageKey" <> '_inventory.txt'
    AND NOT (
      "storageKey" LIKE 'teachers/%'
      AND "storageKey" NOT LIKE 'teachers/guides/%'
    )
    AND NOT (
      "storageKey" LIKE 'students/%'
      AND "storageKey" NOT LIKE 'students/resources/%'
    )
  );
