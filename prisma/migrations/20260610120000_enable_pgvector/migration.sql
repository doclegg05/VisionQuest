-- Enable pgvector for semantic retrieval (Phase 1 — hybrid RAG).
-- No-op on the dev Supabase project where vector 0.8.0 already exists in
-- schema "public". The extension's types/operators resolve via the default
-- search_path ("$user", public); the hybrid search function additionally
-- pins its own search_path (see 20260610120300_add_sage_hybrid_search_function).
CREATE EXTENSION IF NOT EXISTS vector;
