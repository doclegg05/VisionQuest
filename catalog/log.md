# Catalog Log (newest first)

## 2026-06-30 — Phase 0 baselines
- Document RAG (config/sage-rag-eval.json, student): top1=1/14, top3=1/14, cleanTop3=13/14, audienceLeakage=0, noAnswerPassed=3/3
- Form ranking (config/sage-form-eval.json): top1=<fill>, top3=<fill>, cleanTop3=<fill>, forbiddenHits=<fill>
- Corpus (queried 2026-06-30): 50 active+embedded ProgramDocuments of 513 total (463 orphaned, usedBySage=false); 67 chunk vectors across 43 docs.
- Metric notes: noAnswer = "no document surfaced" (matchedDocuments empty); cleanTop3 is a vanity pass while ~0 docs are retrieved — both become meaningful once Phase 1 improves doc retrieval. Baseline top1/top3 ≈ 1/14 is the Phase-1 target.
