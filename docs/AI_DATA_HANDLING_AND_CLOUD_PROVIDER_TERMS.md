# AI Data Handling and Cloud-Provider Terms

**Owner:** VisionQuest program owner and designated privacy/security reviewer
**Status:** Operational policy reference — cloud processing of live education-record data is **not approved**
**Reviewed:** 2026-07-28
**Review again:** Before any provider, model, billing, retention, or contract change; otherwise at least quarterly

> [!IMPORTANT]
> **No AI model or API is automatically “FERPA compliant.”** FERPA governs the educational agency or institution's disclosure and control of education records. A provider's security features, certifications, “no training” promise, or paid plan can support a compliant implementation, but none replaces the school's disclosure authority, direct control, contract, configuration, and oversight. The U.S. Department of Education says cloud hosting is not prohibited, but the institution must meet the applicable FERPA conditions and use reasonable security methods ([DOE cloud FAQ](https://studentprivacy.ed.gov/sites/default/files/resource_document/file/FAQ_Cloud_Computing_0.pdf); [DOE online-tool FAQ](https://studentprivacy.ed.gov/faq/i-want-use-online-tool-or-application-part-my-course-however-i-am-worried-it-violation-ferpa)).

## Decision in one page

### Current decision

**Keep all live student education-record data and staff-entered student data on the approved local AI path. Do not send it to any cloud model yet.**

This applies to chat text, system context containing student facts, summaries, memories, goals, mood/wellbeing data, alerts, resumes, transcripts, IDs, certificates, signed forms, uploaded files, and model inputs derived from those records. FERPA PII includes direct and indirect identifiers and information linkable to a student ([DOE definition](https://studentprivacy.ed.gov/content/personally-identifiable-information-education-records)).

Only public, non-student program material may use a cloud provider under the current policy. Synthetic test data must be demonstrably fictional and must not be derived from a real student's record.

### FERPA readiness status

| Area | Current status | Evidence and meaning | Required next step |
|---|---|---|---|
| Data-sensitivity vocabulary | **Supports readiness** | `student_record`, `staff_entered`, `public_program`, `system`, and `configured` are defined in [`src/lib/ai/types.ts`](../src/lib/ai/types.ts). | Keep every AI call site explicitly classified; add review coverage for new call sites. |
| Local/cloud provider abstraction | **Supports readiness** | Sage can use local Ollama or cloud Gemini through [`src/lib/ai/provider.ts`](../src/lib/ai/provider.ts). Local operation and endpoint protection are documented in the [local AI operator runbook](./plans/2026-07-02-local-ai-operator-runbook.md). | Keep local as the production path for protected data until all cloud gates below pass. |
| Sensitive-data routing enforcement | **Partial — not fail-closed** | `student_record` and `staff_entered` go local only when `ai_provider = "local"`. An operator can set `ai_provider = "cloud"` and route those same prompts to Gemini during alpha. | Before cloud approval, replace the global override with a provider-specific, reviewed allowlist or otherwise prove sensitive routing fails closed. |
| Attachment cloud gate | **Partial** | File gist/classification uses cloud Gemini only after the `cloud_file_processing` toggle; otherwise it uses local extraction/model/heuristics ([`file-gist.ts`](../src/lib/sage/file-gist.ts), [`classify-attachment.ts`](../src/lib/sage/classify-attachment.ts)). | Treat this toggle as a product preference only. It is **not by itself FERPA written consent or institutional approval**. Keep it off for live protected files. |
| AI audit metadata | **Supports readiness, not authorization** | AI audit events record route, sensitivity, provider class, policy decision, and prompt revision while declaring `contentLogged: false` and `piiLogged: false` ([`audit.ts`](../src/lib/ai/audit.ts)). Audit failure currently warns rather than blocking. | Define monitoring/alert ownership and decide whether protected cloud calls must fail closed when an audit event cannot be written. |
| API-key protection | **Supports readiness** | Per-student keys are encrypted; resolution prefers a personal key, then admin configuration, then environment fallback ([`api-key.ts`](../src/lib/chat/api-key.ts)). | Do not use personal/student Gemini keys for protected data: VisionQuest cannot prove that a student's project is paid or under the institution's contract. |
| Vendor contract / school-official terms | **Not evidenced** | No executed provider agreement, Student DPA, order form, or legal approval is represented in this repository. | Institution/privacy counsel must approve and retain the executed agreement and data-flow record outside the repository. |
| Paid tier and retention controls | **Not evidenced** | Repository configuration does not prove that the Gemini project is marked **Paid**, that optional logging/sharing is off, or that a cloud retention exception is active. Runtime secrets and production records were intentionally not inspected. | Verify by account/project identifiers and screenshots or exports that contain no student data or secrets; archive the approval evidence in the institution's compliance system. |
| Retention and deletion operations | **Partial** | VisionQuest has a draft [data retention policy](./DATA_RETENTION_POLICY.md), but durations remain `OWNER-CONFIRM` and it does not establish a cloud provider's deletion behavior. | Approve durations, map provider retention to them, test access/export/deletion, and document exception handling. |
| **Overall cloud readiness for live education records** | **NOT READY** | Technical preparation exists, but disclosure authority, executed terms, runtime proof, and fail-closed enforcement are incomplete. | Complete every item in “Required before any cloud processing,” then obtain written go-live approval. |

## Local-versus-cloud data classification

The application vocabulary is useful, but the policy meaning must be explicit:

| Classification | Examples | Allowed provider now | Notes |
|---|---|---|---|
| `student_record` | Student chat, goals, progress, mood, certification evidence, resume, memory, uploaded record content | **Local only** | Protected even when obvious names are removed if the remaining information can identify or trace a student. |
| `staff_entered` | Case notes, instructor observations, intervention context, staff prompts about a student | **Local only** | Staff access does not make redisclosure to a vendor permissible. |
| `public_program` | Public schedules, published program rules, public resources with no student context | Local or an approved paid cloud service | Remove student/session context before the call. `preferCloud` is appropriate only at this classification. |
| `system` | Generic system instructions, tool schemas, non-student operational text | Local or an approved paid cloud service | Reclassify as protected if combined with student-specific context in the same request. |
| `configured` | Legacy/general call where sensitivity was not made explicit | **Treat as local-only until classified** | This value is not a data class. It is technical debt and must not be used as permission to send live data to cloud. |

Classification follows the **most sensitive item in the complete request**, including the system prompt, history, retrieved context, tool results, files, cached state, and metadata. Redaction must address indirect identification, not just names.

## Current Gemini implementation

The repository currently:

- Defaults to `gemini-3.1-flash-lite`, overridable with `GEMINI_MODEL` ([`src/lib/gemini.ts`](../src/lib/gemini.ts)).
- Defaults an unset `ai_provider` setting to cloud Gemini; a saved `local` value selects Ollama ([`provider.ts`](../src/lib/ai/provider.ts)).
- Resolves a Gemini key in this order: encrypted per-student key, encrypted/admin-managed platform key, then server environment key ([`api-key.ts`](../src/lib/chat/api-key.ts)).
- Uses the `@google/generative-ai` SDK for provider calls; chat places `systemInstruction` at model creation and explicitly relaxes only dangerous-content filtering to `BLOCK_ONLY_HIGH` because deterministic crisis handling is implemented elsewhere ([`gemini-provider.ts`](../src/lib/ai/gemini-provider.ts)).
- Retries transient Gemini 429/5xx/network failures before any streamed token is delivered.
- Sends consent-gated attachment bytes directly to the Gemini Developer API `generateContent` endpoint for gist/classification; that path uses the server `GEMINI_API_KEY`, not the full per-student key-resolution chain ([`file-gist.ts`](../src/lib/sage/file-gist.ts), [`classify-attachment.ts`](../src/lib/sage/classify-attachment.ts)).

These are implementation facts, **not proof of the deployed provider setting, billing tier, account owner, contract, retention controls, or FERPA readiness**.

### Free Gemini prohibition

Google states that for unpaid Gemini API/AI Studio services it uses submitted content and generated responses to improve products; human reviewers may read them; and users must not submit sensitive, confidential, or personal information ([Gemini API Additional Terms](https://ai.google.dev/gemini-api/terms)). Therefore:

- **Never send protected or confidential VisionQuest data to unpaid Gemini API quota or a free AI Studio project.**
- Do not let a student's personal Gemini key process VisionQuest education-record data.
- Do not assume that possessing an API key proves paid status. Google says Gemini API use is a Paid Service only through a Cloud project associated with an active billing account ([billing guide](https://ai.google.dev/gemini-api/docs/billing/)).

Paid Gemini improves the terms but is still not approved today. Google says paid prompts and responses are not used to improve products and are processed under its data-processing addendum, while abuse monitoring retains prompts, context, and output for 55 days and may include authorized human review of flagged content ([paid-service terms](https://ai.google.dev/gemini-api/terms); [abuse monitoring](https://ai.google.dev/gemini-api/docs/usage-policies)). Optional developer logging/datasets create additional retention and sharing choices and must remain off for protected traffic ([logging policy](https://ai.google.dev/gemini-api/docs/logs-policy)).

## Required before any cloud provider receives live records

All items are mandatory unless institution/privacy counsel documents why a different FERPA disclosure exception applies.

### 1. Establish the legal and governance basis

- [ ] Identify the educational agency or institution responsible for the records and the official authorized to approve disclosure.
- [ ] Document the disclosure basis. For the school-official exception, the provider must perform an outsourced institutional service, be under the institution's direct control for use and maintenance of the records, fit the institution's annual FERPA notice/legitimate-interest criteria, and comply with FERPA use and redisclosure limits ([DOE online-tool FAQ](https://studentprivacy.ed.gov/faq/i-want-use-online-tool-or-application-part-my-course-however-i-am-worried-it-violation-ferpa); [DOE cloud FAQ](https://studentprivacy.ed.gov/sites/default/files/resource_document/file/FAQ_Cloud_Computing_0.pdf)).
- [ ] Execute institution-approved terms covering purpose limitation, direct control, no unauthorized use/redisclosure, subprocessors, security, incident notice, access/correction support, retention, return/deletion, audit evidence, and notice of material term changes. DOE recommends strong written agreements and monitoring to demonstrate direct control ([DOE vendor FAQ](https://studentprivacy.ed.gov/sites/default/files/resource_document/file/Vendor%20FAQ.pdf)).
- [ ] Confirm the institution's annual FERPA notice defines the contractor/school-official and legitimate educational interest as required.
- [ ] Complete state student-privacy, grant, procurement, records-management, and security review. FERPA may not be the only or strictest applicable rule ([DOE cloud FAQ](https://studentprivacy.ed.gov/sites/default/files/resource_document/file/FAQ_Cloud_Computing_0.pdf)).
- [ ] Record a named data owner, security owner, contract owner, incident contact, and quarterly review date.

An in-app toggle is not a substitute for this work. If relying instead on written consent, privacy counsel must confirm that the consent satisfies FERPA and describes the records, purpose, and recipients; do not infer that the current `cloud_file_processing` toggle does so.

### 2. Approve the exact service boundary

- [ ] Name the legal provider, product, account/tenant/project, API endpoint, model/version, region, features, subprocessors, and all downstream tools.
- [ ] Use an institution-owned paid/enterprise account. Ban personal accounts, personal API keys, free tiers, playgrounds, and consumer chat products for live records.
- [ ] Confirm in writing that customer content is not used to train or improve general models unless the institution explicitly opts in.
- [ ] Select the shortest approved retention or zero-data-retention mode. Disable optional request logging, feedback sharing, datasets, stored conversations, batch/stateful APIs, grounding/search, prompt caching, and cross-region processing until each is separately reviewed.
- [ ] Verify the feature-level exceptions: a provider's “zero retention” setting may not apply to every endpoint, tool, file, image, cache, abuse-monitoring path, or third-party model.
- [ ] Retain the executed agreement, DPA/Student DPA, order form, provider configuration evidence, subprocessor list, and approved data-flow diagram in the institution's compliance repository—not in Git and never with secrets.

### 3. Make VisionQuest fail closed

- [ ] Prevent `student_record`, `staff_entered`, and unclassified `configured` requests from reaching cloud unless the exact provider/project has an active approval record.
- [ ] Remove or constrain the current global cloud override for sensitive prompts.
- [ ] Disable protected-data use of per-student Gemini keys.
- [ ] Require a successful audit event for every approved protected cloud call, or formally accept and monitor the risk of non-blocking audit failures.
- [ ] Minimize each request to the fields needed for the task; strip direct and indirect identifiers when the task can operate without them.
- [ ] Inventory chat, extraction, memory, briefing, resume, attachment, RAG/embedding, tool-result, retry, and fallback paths. A fallback must not silently cross into an unapproved provider.
- [ ] Test the complete production configuration with synthetic records, including outage/fallback, logging failure, revoked consent/approval, deletion, and provider-setting changes.

### 4. Obtain written go-live approval

- [ ] Privacy/legal owner approves the disclosure basis and contract.
- [ ] Security owner approves the architecture and verified provider settings.
- [ ] Program/data owner approves purpose, minimum fields, retention, and operator procedure.
- [ ] A release record names the exact approved provider/project/model/features and an expiration/review date.

Until all four sections pass, the decision remains **local only**.

## Provider comparison

This is a due-diligence starting point, not a ranking or approval. Product names alone are insufficient; terms and controls vary by account, endpoint, feature, model, and region.

| Service | Published customer-data position | Retention/control considerations | FERPA/contract position | VisionQuest status |
|---|---|---|---|---|
| **Paid Gemini Developer API** | Paid prompts/responses are not used to improve Google's products and are processed under Google's processor DPA ([terms](https://ai.google.dev/gemini-api/terms)). | Gemini documents 55-day abuse-monitoring retention of prompts, context, and output, with possible review of flagged content; optional project logging/datasets add separate retention/sharing choices ([abuse monitoring](https://ai.google.dev/gemini-api/docs/usage-policies); [logging](https://ai.google.dev/gemini-api/docs/logs-policy)). Data may be cached/transiently stored where Google or its agents have facilities ([terms](https://ai.google.dev/gemini-api/terms)). | Google publishes FERPA language for Workspace for Education, but that page does not itself approve the Gemini Developer API ([Google FERPA page](https://cloud.google.com/security/compliance/ferpa)). The paid-service DPA supports processor controls; the institution must still establish direct control and approved terms for this exact service. | **Not approved.** Current integration target, but paid status/terms/settings are unverified and default abuse retention remains material. |
| **Vertex AI Gemini** | Google says it will not train/fine-tune managed Vertex models on customer data without prior permission or instruction ([Vertex retention guide](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/vertex-ai-zero-data-retention)). The Google Cloud DPA provides processor, instruction, security, incident, deletion, subprocessor, and audit commitments ([Cloud DPA](https://cloud.google.com/terms/data-processing-addendum/)). | Customers may need an abuse-monitoring exception for zero retention; default in-memory Gemini caching has a 24-hour TTL and can be disabled. Search/Maps grounding stores data for 30 days and cannot be made zero-retention ([Vertex retention guide](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/vertex-ai-zero-data-retention)). | Stronger enterprise control surface than the current direct Developer API path, but the institution still needs exact contractual FERPA analysis and configuration evidence. Google's public FERPA page specifically describes Workspace, not blanket certification of every Cloud AI service ([Google FERPA page](https://cloud.google.com/security/compliance/ferpa)). | **Conditional candidate.** Prefer over direct Gemini Developer API when Google is selected, subject to contract, abuse-log exception, cache/grounding controls, and a new reviewed integration. |
| **OpenAI API** | API data is not used for model training by default unless the customer opts in ([OpenAI data controls](https://platform.openai.com/docs/models/default-usage-policies-by-endpoint)). The standard DPA makes OpenAI a processor for customer data ([OpenAI DPA](https://cdn.openai.com/pdf/openai-data-processing-addendum.pdf)). | Default abuse-monitoring logs may include prompts/responses and are retained up to 30 days. Eligible approved customers can use Modified Abuse Monitoring or Zero Data Retention, but endpoint exceptions and application state remain feature-specific ([data controls](https://platform.openai.com/docs/models/default-usage-policies-by-endpoint)). | OpenAI publishes a Student DPA defining school-official/direct-control duties, but it becomes effective through an applicable order form/services agreement and may require a mutually executed offline agreement for the chosen service ([Student DPA](https://cdn.openai.com/osa/openai-sdpa.pdf)). Do not assume a self-service API account is covered. | **Conditional candidate.** Requires an institution-executed Student DPA/order, approved retention controls, endpoint allowlist, and a new reviewed integration. |
| **Azure OpenAI / Azure Direct Models** | Microsoft says prompts/completions are not used to train or improve base models and the deployed models are stateless ([Azure data privacy](https://learn.microsoft.com/en-us/azure/foundry/responsible-ai/openai/data-privacy)). | Flagged content may enter a separated abuse-monitoring store and human review; approved Modified Abuse Monitoring removes that storage/human-review path, though automated review remains ([Azure data privacy](https://learn.microsoft.com/en-us/azure/foundry/responsible-ai/openai/data-privacy)). Region behavior depends on regional, Data Zone, or global deployment. | Microsoft states that its DPA designates Microsoft a school official with legitimate educational interests, binds it to 34 CFR 99.33(a), and includes Azure; it also states FERPA does not recognize a provider certification and the institution must assess its own use ([Microsoft FERPA offering](https://learn.microsoft.com/en-us/compliance/regulatory/offering-ferpa); [current DPA](https://www.microsoft.com/licensing/docs/view/Microsoft-Products-and-Services-Data-Protection-Addendum-DPA?lang=1)). | **Strongest published FERPA contract posture in this comparison, but still conditional.** Requires institutional acceptance, deployment/monitoring controls, and a new reviewed integration. |
| **Amazon Bedrock** | AWS describes security/compliance as shared responsibility and publishes a FERPA resource guide for building compliant workloads ([AWS FERPA](https://aws.amazon.com/compliance/ferpa/); [Bedrock security](https://docs.aws.amazon.com/bedrock/latest/userguide/security.html)). | Current modes include `none` (immediate discard/no provider sharing), `default` (some models/APIs may retain up to 30 days), and explicit `provider_data_share` (provider sharing and up to 30-day retention). Models and APIs have different allowed modes; SCPs can enforce `none` ([AWS retention guidance](https://aws.amazon.com/blogs/security/enforce-zero-data-retention-on-amazon-bedrock-with-bedrock-projects-and-service-control-policies/)). | AWS provides FERPA guidance and controls, not automatic compliance. The institution must verify the AWS agreement, exact model terms, selected mode, region, IAM/SCP boundary, deletion, and direct-control obligations. | **Conditional candidate.** Consider only with `none` enforced, a compatible model/API, institution-approved AWS terms, and a new reviewed integration. |

### Pricing snapshot

Pricing changes frequently and is not a compliance control. The figures below are public list-price examples in USD as checked **2026-07-28**, per 1 million text tokens unless noted. They exclude tools, grounding, storage, networking, reserved capacity, support, and taxes.

| Service/example | Input | Output | Source/qualification |
|---|---:|---:|---|
| Gemini Developer API, `gemini-3.1-flash-lite`, Standard paid tier | $0.25 | $1.50 | [Google pricing](https://ai.google.dev/gemini-api/docs/pricing). Batch/Flex list at $0.125/$0.75; price does not eliminate 55-day abuse monitoring. |
| Vertex AI | Varies | Varies | [Vertex AI pricing](https://cloud.google.com/vertex-ai/generative-ai/pricing). Confirm the exact model/version, location, deployment type, and Cloud SKU; do not copy the Developer API rate into a procurement estimate without verification. |
| OpenAI API, `gpt-5.4-mini` | $0.75 | $4.50 | [OpenAI model pricing](https://developers.openai.com/api/docs/models/gpt-5.4-mini). Regional processing carries a published uplift; retention-control eligibility is separate. |
| Azure OpenAI | Varies | Varies | [Azure pricing](https://azure.microsoft.com/en-us/pricing/details/cognitive-services/openai-service/). Pay-as-you-go is token based; Batch is advertised at 50% off Global Standard; exact public figures depend on model, region, currency, and deployment. |
| Bedrock, GPT-5.6 Luna, US in-region example | $1.10 | $6.60 | [Bedrock pricing](https://aws.amazon.com/bedrock/pricing/). Bedrock prices vary substantially by model, provider, region, tier, cache, and endpoint. |

## Concise operator checklist

Before a release or provider-setting change:

1. **Classify:** Does the full request contain or derive from a student record or staff-entered student information? If yes or uncertain, use local.
2. **Verify runtime:** Confirm `ai_provider` and the exact endpoint without reading or exposing secrets. An unset value defaults to cloud.
3. **Ban free/personal routes:** No free Gemini, AI Studio, consumer chatbot, personal account, or student API key for protected data.
4. **Check approval record:** Is there a current written approval naming the provider, product, project, model, region, features, contract, retention mode, and review date? If no, use local.
5. **Check controls:** Confirm no optional logging/sharing/training, no unreviewed grounding/state/cache, minimum retention, least-privilege identity, encryption, and audit monitoring.
6. **Minimize:** Send only fields required for the approved purpose; remove direct and indirect identifiers when possible.
7. **Test:** Use synthetic data to prove routing, fallback, audit, revocation, and deletion before live traffic.
8. **Stop on drift:** Any model, endpoint, terms, subprocessor, region, billing, or retention change returns the path to local-only pending review.

## What is prohibited now

- Sending any live protected VisionQuest data to free/unpaid Gemini API quota, Google AI Studio free services, consumer AI products, personal projects, or personal/student API keys.
- Setting the production sensitive-data path to cloud merely because the API is paid or says “no training.”
- Treating the `cloud_file_processing` toggle as sufficient FERPA consent or institutional authorization.
- Uploading resumes, IDs, transcripts, signed forms, certificates, chat histories, screenshots, or exports containing real student data to any unapproved cloud model.
- Enabling provider feedback sharing, contributed datasets, optional request logs, stored conversations, grounding/search, stateful assistants, batch storage, or cross-region processing for protected data without separate review.
- Using `configured` or missing classification as permission for cloud processing.
- Copying production prompts, responses, logs, database records, or student-file contents into support tickets, issue trackers, documentation, or AI troubleshooting tools.
- Claiming VisionQuest, a provider, or a model is “FERPA certified” or automatically compliant.

## Source maintenance

Only primary sources are used here: U.S. Department of Education guidance and official provider terms/documentation. At each review:

1. Re-open every linked terms, privacy, retention, FERPA, and pricing page.
2. Compare effective dates and archive the reviewed versions in the institution's contract/compliance system.
3. Recheck exact endpoint/model retention exceptions and subprocessors.
4. Update this document's date, status table, pricing snapshot, and decision.
5. If facts cannot be verified, keep or return the affected route to local-only.

This document is operational guidance, not legal advice. The educational agency or institution and its counsel remain responsible for the final FERPA determination.
