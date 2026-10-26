#!/usr/bin/env node
// Real PostgreSQL/pgvector regression and timing test. Synthetic rows only.
// Requires a dedicated, empty local database named vq_ai_retrieval_test.
// All schema, roles, and fixture data are rolled back, even after an SQL error.
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const url = process.env.AI_RETRIEVAL_TEST_URL;
if (!url) throw new Error("Set AI_RETRIEVAL_TEST_URL to the dedicated local test database.");
const parsed = new URL(url);
if (!["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname)
    || parsed.pathname !== "/vq_ai_retrieval_test") {
  throw new Error("Refusing non-local or non-test database.");
}
const before = readFileSync(new URL("../prisma/migrations/20260710131500_search_chunk_text_and_return_source_key/migration.sql", import.meta.url), "utf8")
  .replaceAll("sage_hybrid_search", "sage_hybrid_search_before");
const migration = readFileSync(new URL("../prisma/migrations/20260910124749_optimize_sage_ai_retrieval/migration.sql", import.meta.url), "utf8");
const timestampMigration = readFileSync(new URL("../prisma/migrations/20260910130409_clarify_ai_passage_timestamp/migration.sql", import.meta.url), "utf8");
const extractionMigration = readFileSync(new URL("../prisma/migrations/20260910135415_track_ai_passage_extraction/migration.sql", import.meta.url), "utf8");
const sql = `
BEGIN;
SET LOCAL statement_timeout = '90s';
CREATE EXTENSION IF NOT EXISTS vector;
CREATE SCHEMA visionquest;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='vq_app') THEN CREATE ROLE vq_app; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
END $$;
CREATE TABLE visionquest."ProgramDocument" (
  id text PRIMARY KEY, title text NOT NULL, "storageKey" text UNIQUE NOT NULL,
  "sageContextNote" text, "usedBySage" boolean, "isActive" boolean,
  audience text, category text, "certificationId" text, "platformId" text,
  "fileModifiedAt" timestamp, embedding vector(768), "embeddingModel" text,
  "updatedAt" timestamp DEFAULT now()
);
CREATE TABLE visionquest."DocumentChunk" (
  id text PRIMARY KEY, "documentId" text REFERENCES visionquest."ProgramDocument",
  "chunkIndex" int, content text, embedding vector(768), "embeddingModel" text,
  "tokenCount" int, "pageNumber" int, "sectionTitle" text,
  "createdAt" timestamp DEFAULT now(), "updatedAt" timestamp DEFAULT now(),
  fts tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED,
  UNIQUE ("documentId", "chunkIndex")
);
CREATE INDEX ON visionquest."DocumentChunk" ("documentId");
CREATE INDEX ON visionquest."DocumentChunk" USING gin(fts);
CREATE INDEX ON visionquest."ProgramDocument" USING gin(to_tsvector('english',title || ' ' || coalesce("sageContextNote",'')));
INSERT INTO visionquest."ProgramDocument" (id,title,"storageKey","sageContextNote","usedBySage","isActive",audience,category,"certificationId","platformId","fileModifiedAt",embedding,"embeddingModel")
SELECT 'd'||i, CASE WHEN i%11=0 THEN 'Certification exam' ELSE 'Attendance policy' END,
       'synthetic/'||i||'.pdf', 'Training policy '||i, i%7<>0, i%5<>0,
       CASE WHEN i%3=0 THEN 'TEACHER' ELSE 'BOTH' END, 'PROGRAM_POLICY', NULL, NULL, NULL,
       CASE WHEN i%13=0 THEN NULL ELSE
         (SELECT array_agg(sin((i*j)::float8)) FROM generate_series(1,768) j)::vector END,
       CASE WHEN i%17=0 THEN 'stale-model' ELSE 'test-model' END
FROM generate_series(1,1200) i;
INSERT INTO visionquest."DocumentChunk" (id,"documentId","chunkIndex",content,embedding,"embeddingModel")
SELECT 'c'||i||'-'||k, 'd'||i, k,
       CASE WHEN k=1 THEN 'Exact body-only quasar enrollment' ELSE 'Attendance procedure details' END,
       CASE WHEN i%19=0 THEN NULL ELSE
         (SELECT array_agg(cos((i*j+k)::float8)) FROM generate_series(1,768) j)::vector END,
       CASE WHEN i%23=0 THEN 'stale-model' ELSE 'test-model' END
FROM generate_series(1,1200) i CROSS JOIN generate_series(1,6) k;
ALTER TABLE visionquest."ProgramDocument" ENABLE ROW LEVEL SECURITY;
ALTER TABLE visionquest."DocumentChunk" ENABLE ROW LEVEL SECURITY;
CREATE POLICY document_read ON visionquest."ProgramDocument" TO vq_app USING (
  current_setting('app.current_role',true) IN ('teacher','admin') OR audience='BOTH'
  OR (audience='STUDENT' AND current_setting('app.current_role',true)='student')
);
CREATE POLICY chunk_read ON visionquest."DocumentChunk" TO vq_app USING (
  EXISTS(SELECT FROM visionquest."ProgramDocument" d WHERE d.id="documentId")
);
GRANT USAGE ON SCHEMA visionquest TO vq_app;
GRANT SELECT ON ALL TABLES IN SCHEMA visionquest TO vq_app;
${before}
${migration}
${timestampMigration}
${extractionMigration}
ANALYZE visionquest."ProgramDocument";
ANALYZE visionquest."DocumentChunk";
DO $$ DECLARE q vector; term text; viewer text; model text; mismatches int; BEGIN
  SELECT embedding INTO q FROM visionquest."ProgramDocument" WHERE id='d1';
  FOREACH term IN ARRAY ARRAY['attendance','quasar','exam OR policy','','nonexistenttoken'] LOOP
    FOREACH viewer IN ARRAY ARRAY['student','staff'] LOOP
      FOREACH model IN ARRAY ARRAY['test-model','stale-model','missing-model'] LOOP
        SELECT count(*) INTO mismatches FROM (
          (SELECT * FROM visionquest.sage_hybrid_search_before(q,term,viewer,model,30)
           EXCEPT SELECT * FROM visionquest.sage_hybrid_search(q,term,viewer,model,30))
          UNION ALL
          (SELECT * FROM visionquest.sage_hybrid_search(q,term,viewer,model,30)
           EXCEPT SELECT * FROM visionquest.sage_hybrid_search_before(q,term,viewer,model,30))
        ) diff;
        IF mismatches<>0 THEN RAISE EXCEPTION 'Ranking changed: %, %, %',term,viewer,model; END IF;
      END LOOP;
    END LOOP;
  END LOOP;
  IF NOT EXISTS(SELECT FROM visionquest.sage_hybrid_search(NULL,'quasar','student','missing-model',30))
    THEN RAISE EXCEPTION 'Keyword-only body recall lost'; END IF;
  IF EXISTS(SELECT FROM visionquest."DocumentChunk" WHERE "tokenCount" IS NULL OR "pageNumber" IS NOT NULL)
    THEN RAISE EXCEPTION 'Metadata backfill invalid'; END IF;
  IF EXISTS(SELECT FROM visionquest.ai_knowledge_passages WHERE record_kind='body' AND extraction_method <> 'unknown')
    THEN RAISE EXCEPTION 'Legacy extraction provenance mislabeled'; END IF;
  IF has_table_privilege('anon','visionquest.ai_knowledge_passages','SELECT')
    OR has_table_privilege('authenticated','visionquest.ai_knowledge_passages','SELECT')
    THEN RAISE EXCEPTION 'Passages exposed to API roles'; END IF;
END $$;
SET LOCAL ROLE vq_app;
SELECT set_config('app.current_role','student',true);
DO $$ BEGIN
  IF EXISTS(SELECT FROM visionquest.ai_knowledge_passages WHERE audience='TEACHER')
    THEN RAISE EXCEPTION 'View bypasses RLS'; END IF;
  IF EXISTS(SELECT FROM visionquest.ai_knowledge_passages p JOIN visionquest."ProgramDocument" d ON d.id=p.document_id
    WHERE NOT d."isActive" OR NOT d."usedBySage")
    THEN RAISE EXCEPTION 'Inactive/unapproved data surfaced'; END IF;
  IF NOT EXISTS(SELECT FROM visionquest.ai_knowledge_passages) THEN RAISE EXCEPTION 'Student passages empty'; END IF;
END $$;
RESET ROLE;
CREATE TEMP TABLE timings (variant text, milliseconds float8);
DO $$ DECLARE q vector; started timestamptz; i int; BEGIN
  SELECT embedding INTO q FROM visionquest."ProgramDocument" WHERE id='d1';
  FOR i IN 1..12 LOOP
    started=clock_timestamp();
    PERFORM * FROM visionquest.sage_hybrid_search_before(q,'quasar','student','test-model',12);
    IF i>2 THEN INSERT INTO timings VALUES ('before',1000*extract(epoch FROM clock_timestamp()-started)); END IF;
    started=clock_timestamp();
    PERFORM * FROM visionquest.sage_hybrid_search(q,'quasar','student','test-model',12);
    IF i>2 THEN INSERT INTO timings VALUES ('after',1000*extract(epoch FROM clock_timestamp()-started)); END IF;
  END LOOP;
END $$;
SELECT jsonb_build_object('verified_comparisons',30,'synthetic_documents',1200,'synthetic_chunks',7200,
  'timings',(SELECT jsonb_agg(x) FROM (SELECT variant,percentile_cont(0.5) WITHIN GROUP(ORDER BY milliseconds) AS median_ms FROM timings GROUP BY variant) x));
ROLLBACK;
`;
process.stdout.write(execFileSync("psql", [url, "-X", "-q", "-v", "ON_ERROR_STOP=1"], {
  input: sql, encoding: "utf8", maxBuffer: 2 * 1024 * 1024,
}));
