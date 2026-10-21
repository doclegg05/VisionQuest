# Prior Session (2026-10-15, desktop app and per-classroom models)
- **Date**: 2026-10-15
- **What we worked on**: Britt asked whether VisionQuest should become a downloadable desktop app with bundled local models, so an instructor outside the team could install it. Three findings:
  - **Secrets.** A desktop app that connects straight to Supabase would ship `DATABASE_URL`, `JWT_SECRET` and the storage keys inside every install.
  - **Onboarding needs no download.** A same-program instructor already fits: teacher registration plus a class created with them as instructor and a region (`/api/teacher/classes`).
  - **AI routing is program-wide.** `ai_provider_url` is one `SystemConfig` value, so every class shares one local AI host today.
- **Per-computer test**: Britt then proposed that each classroom PC run its own model, with students using only classroom PCs. A throwaway PowerShell timing kit sent Sage's real compact prompt plus the 19 readonly student tools. Britt ran it on classroom PC J4LTC14, guided by a remote Claude session, and carried the files on the T9 drive.
- **Results** (gemma4:e2b-it-qat, 8 scenarios, each with a follow-up):

  | Measure | Result |
  |---|---|
  | Hardware | i5-13500T, 7.7 GB RAM, Intel UHD 770, so the model ran 100% on CPU |
  | Models that fit | only gemma4:e2b, because e4b needs 16 GB |
  | First message | 55 to 58 s to first word, about 60 s full, 0 of 8 within targets |
  | Follow-up | 0.4 s to first word, 2.4 to 3.9 s full, 8 of 8 |
  | Prompt read speed | about 93 tokens/s over 5,200 to 5,400 tokens (about 3,000 base plus 2,300 for tools) |
  | Reply write speed | about 11 tokens/s |
  | Model load | 13 to 18 s |
  | Mac baseline | M4, 32 GB, gemma4:e4b: 22 to 24 s to first word on a first message |

  Replies were safe but weaker. They repeated the scripted check-in opener, asked "How did your IC3 test go?" after Sam said they passed, and ignored the certification facts supplied in the prompt.
- **What we decided**: shelve per-computer models and keep classes on the shared host. See the decision log.
- **Where we left off**:
  - **Shared host follow-up.** The follow-up numbers are a best case, because the test kept the prompt identical between turns. Production appends per-message RAG, memory and recent activity to the end of the system prompt, so the shared host likely re-reads the conversation history on every turn. Session "Measure Sage prompt-cache reuse on local AI" is measuring this, read-only.
  - **Where the kit lives.** The kit and results exist only in `scratch/classroom-ai-test/` (gitignored, on this Mac, results in `results-from-classroom/`) and on the T9.
  - **Script bug.** In PowerShell 5.1 the script's `$PSScriptRoot` param defaults come out empty under `-File`, so pass `-PromptFile` and `-OutDir` on the command line.
  - **No product code changed.**

