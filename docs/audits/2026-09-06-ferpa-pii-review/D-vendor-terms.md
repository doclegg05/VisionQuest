# D — Cloud LLM vendor terms for FERPA-style student data (VisionQuest)

Research date: **2026-09-06**. All quotes are from the vendor's own terms/docs pages fetched on that
date. Anything I could not read from a primary source is marked **UNVERIFIED** and says why.

Framing note used throughout: **FERPA has no certification.** No vendor is "FERPA compliant" as a
product property. What a vendor can offer is (a) a written commitment to act as a *school official
under the direct control of the institution* (34 CFR §99.31(a)(1)), (b) a DPA that binds them to
process only on instruction, (c) no-training and short-retention terms, (d) a subprocessor list and
breach notice. VisionQuest (or SPOKES/WVDE) still has to make the school-official designation in its
own contract and annual notification. Rank vendors by *how much of that they hand you in writing
without a sales cycle*.

---

## 1. Google

### 1a. Gemini Developer API (ai.google.dev) — what VisionQuest uses today

**Source: https://ai.google.dev/gemini-api/terms — "Gemini API Additional Terms of Service",
effective date on page: March 23, 2026.**

Unpaid tier:
> "Google uses the content you submit to the Services and any generated responses to provide,
> improve, and develop Google products and services"

and for unpaid tiers:
> "human reviewers may read, annotate, and process your API input and output"

Paid tier:
> "Google doesn't use your prompts (including associated system instructions, cached content, and
> files such as images, videos, or documents) or responses to improve our products"

**Is Flash Lite on a billed project actually "paid tier"? Yes — but the trigger is the billing link,
not the model.** The terms define Paid Services for the API as being available
> "only when accessing the API through a Cloud Project associated with an active billing account"

So the operative test is: *the API key's Cloud project has an active Cloud Billing account attached.*
Model choice is irrelevant. A key minted in AI Studio against a project with no billing account is
**unpaid tier**, and unpaid tier is training-eligible and human-reviewable. This is the single most
important fact in this whole report for VisionQuest's current posture.

Regional carve-out: for the EEA, Switzerland and the UK the paid-services data terms apply to all
tiers including free. West Virginia gets no such carve-out.

Retention / abuse logging on paid tier: the terms say logs are retained
> "solely for detecting and preventing violations of the Prohibited Use Policy"

but **UNVERIFIED: the paid-tier abuse-log retention period in days.** The ZDR doc says only that
"Google logs prompts and responses for a limited period of time solely for detecting violations."
The only concrete number on the page is for grounding: with Grounding with Google Search (or Maps),
> "Google will store prompts, contextual information ... for thirty (30) days"

and
> "There is no way to disable the storage of this information if you use Grounding with Google Search"

**New and material: there is now a ZDR path on the Developer API itself.**
Source: https://ai.google.dev/gemini-api/docs/zdr
> "When your request for ZDR for a particular project is approved, all user content (prompts and
> responses) and identifiable metadata (such as IP addresses and Google Account IDs) are cleared
> prior to logging."

Incompatible with ZDR per that page: Grounding with Google Search, Grounding with Google Maps,
Interactions API unless `store: false`, Live API with `SessionResumptionConfig`, explicit context
caching (`cached_content`), and the File API (files must be manually deleted).

**UNVERIFIED: the actual mechanism to request Developer-API ZDR.** The doc says "when your request
... is approved" and points enterprise users at the Gemini Enterprise Agent Platform ZDR guide, but
names no form URL, no self-serve toggle, and no eligibility bar. Treat it as "ask Google, outcome
unknown" until you try it. It is *not* a checkbox.

### 1b. Vertex AI / "Gemini Enterprise Agent Platform" on Google Cloud

Google renamed/reorganised the Vertex generative-AI docs into "Gemini Enterprise Agent Platform"
(docs.cloud.google.com/gemini-enterprise-agent-platform/...). Several of those pages returned
navigation-only content to my fetcher, so the items below marked UNVERIFIED are real gaps, not
absences of the feature.

**Cloud Data Processing Addendum — source: https://cloud.google.com/terms/data-processing-addendum.**
This is the strongest self-serve item on the Google side:
> "This Cloud Data Processing Addendum (including its appendices, the 'Addendum') is **incorporated
> into the Agreement(s)** ... between Google and Customer."

i.e. **no signature ceremony — accepting Google Cloud terms gets you the DPA.** Breach notice:
> "Google will notify Customer promptly and without undue delay after becoming aware of a Data
> Incident, and promptly take reasonable steps to minimize harm and secure Customer Data."

No fixed hour count. Deletion on instruction: "as soon as reasonably practicable and within a maximum
period of 180 days" (§6.1), plus a 30-day recovery period at end of term (§6.2). Subprocessor list
maintained with an objection opportunity (§11).

Zero data retention on Vertex: the recipe is **two separate things** — disable per-project prompt
caching, *and* get an abuse-monitoring logging exception. The abuse-monitoring exception is obtained
by form request or by having invoiced billing; "If approved, Google won't store any prompts
associated with the approved Google Cloud account." **UNVERIFIED: I could not read the
abuse-monitoring page or the Vertex ZDR page directly** (both returned nav-only). The two-step recipe
and the form/invoiced-billing route come from search-result snippets of those Google pages plus a
practitioner writeup, not from my own read of the page body. Verify before relying on it.

Caching: default Vertex behaviour reported as in-memory prompt caching retaining prompt data at the
project level for up to 24 hours, disableable via API. **UNVERIFIED** for the same reason.

Data residency: Vertex exposes jurisdictional/regional endpoints where ML processing stays in the
named region (US multi-region supported for the Flash/Pro families). The **global endpoint does not
give you residency** — this bit people: there is an open google-gemini/gemini-cli issue
(#27984, "Vertex AI with API key ignores GOOGLE_CLOUD_LOCATION and uses the global endpoint (data
residency)"). Pin the region explicitly. **UNVERIFIED: exact current model×region matrix for
Gemini 3.1 Flash Lite on Vertex** — I could not load the residency page body. Historically every
Gemini model reaches Vertex, usually simultaneously; assume yes, but confirm before migrating.

**Google Cloud's FERPA statement — this is the weak spot.** I attempted
https://cloud.google.com/security/compliance/ferpa four times and got truncated navigation every
time, so **UNVERIFIED: the body text of Google Cloud's own FERPA page.** What I *can* source is that
Google's FERPA "school official" commitment is written against **Google Workspace for Education**,
not Google Cloud Platform generally. The commitment language ("Google agrees to be considered a
'School Official' (as that term is used in FERPA)... act as a school official with a legitimate
educational interest; perform an institutional service or function under the direct control of
Customer...") appears in Workspace-for-Education-scoped agreements and is described as applying to
"Google Workspace for Education Services currently certified against ISO 27018." I found **no
Google commitment to be designated a school official for Vertex AI or the Gemini Developer API.**
Compare Microsoft, which names Azure explicitly (§4). If FERPA paper is the deciding factor, this
asymmetry matters and should be put to a Google rep in writing.

### 1c. Gemini for Education / Workspace for Education (contrast only — not an API path)

Gemini for Education and the Gemini app are **Core Services** under the Google Workspace for
Education Terms of Service, with "enterprise-grade data protection" extended free to all Workspace
for Education editions as of 2025-03-31: data "is not human reviewed or used to train AI models,"
and Google states support for COPPA and FERPA compliance. This is the tier with the real FERPA
paper — and it is a **seat-licensed end-user product, not an API you can build VisionQuest on.**
Useful as a benchmark for what Google is willing to say when it wants to, and as a fallback if SPOKES
ever wants teacher-facing AI outside the app.

---

## 2. Anthropic (Claude API)

**Commercial Terms — https://www.anthropic.com/legal/commercial-terms, effective June 17, 2025:**
> "Anthropic may not train models on Customer Content from Services."
> "Customer (a) retains all rights to its Inputs, and (b) owns its Outputs."

Note the shape: it is a flat prohibition in the contract, not a setting. There is no toggle to get
wrong and no free tier that behaves differently — the API is commercial by definition.

**Default retention — https://platform.claude.com/docs/en/manage-claude/api-and-data-retention:**
> "Retained data is never used for model training without your express permission."
> "Only what is technically necessary for the feature to work is retained. Conversation content
> (your prompts and Claude's outputs) is not retained by default; the exception is Covered Models,
> which require 30-day retention."

So the *default* on the Claude API is already close to ZDR for conversation content on
non-Covered-Model traffic. That is a stronger default than Google's or OpenAI's.

**ZDR is NOT self-serve:**
> "To request ZDR for your organization, contact the Anthropic sales team. ZDR is enabled per
> organization; each new organization requires ZDR to be enabled separately by your account team."

**Important trap for a small buyer: the newest models are excluded from ZDR.** Claude Fable 5.1,
Mythos 5.1, Fable 5 and Mythos 5 are designated **Covered Models** and
> "require 30-day data retention; ZDR is therefore not available for any of them unless expressly
> authorized by Anthropic."

Requests to them from a ZDR org return `400 invalid_request_error` ("your organization or workspace
must have data retention enabled"). Retention for Covered Models is 30 days and then automatic
deletion "except in the rare cases where it's been flagged by our automated trust and safety systems
or we're legally required to keep it." **Haiku 4.5 is not a Covered Model**, so the cheap/fast tier
VisionQuest would actually use is ZDR-eligible.

Regardless of arrangement:
> "if a chat or session is flagged, Anthropic may retain inputs and outputs for up to 2 years."

**BAA/HIPAA is self-serve — and this is the surprising one.** Console → Settings → Privacy → HIPAA
compliance card: "Download the Business Associate Agreement and the HIPAA Implementation Guide, then
accept the agreement as an authorized legal representative of your organization." Enablement is
immediate and **permanent — "cannot be disabled by an administrator."** Anthropic frames HIPAA
readiness as *broader* than ZDR ("encryption, access controls, and audit logging that protect PHI
throughout its lifecycle... If your organization handles PHI, HIPAA readiness is the arrangement to
use; you do not also need ZDR"). VisionQuest handles education records, not PHI, so a BAA is not
legally the right instrument — but it is worth knowing that Anthropic will hand a self-serve
regulated-data agreement to a small account, which is more than Google or OpenAI do at this scale.

**DPA is self-serve (auto-incorporated)** — https://privacy.claude.com/en/articles/7996862:
> "Anthropic's DPA with Standard Contractual Clauses (SCCs) is automatically incorporated into our
> Commercial Terms of Service"

Covers Claude for Work and the Claude API; does not cover consumer Free/Pro. Subprocessor list lives
in the Trust Center (trust.anthropic.com) under a "Subprocessors" tab, with advance notice of
changes.

**Data residency is a first-class API parameter** —
https://platform.claude.com/docs/en/manage-claude/data-residency:
`inference_geo: "us"` on `POST /v1/messages`, "Inference runs only in US-based infrastructure,"
default is `"global"`. Enforceable at workspace level via `allowed_inference_geos: ["us"]` and
`default_inference_geo`, settable in Console or Admin API — so it is a policy, not a per-call
discipline. Workspace geo (data at rest) currently only `"us"`. **Cost: 1.1x on all token
categories.** Supported on Claude 4.6 and later only; earlier models 400 on the parameter. Response
echoes `usage.inference_geo` so you can assert it in a test.

**ZDR blocks CORS:** "CORS is not supported for organizations with ZDR arrangements. To make API
calls from browser-based applications, route requests through a backend proxy server." VisionQuest
already calls the model server-side from `/api/chat/send`, so this costs nothing here — but it would
break any future browser-direct call.

**Claude for Education / FERPA:** Anthropic publishes a **K-12 Data Processing Addendum** at
anthropic.com/legal/k12-dpa with FERPA-aligned protections; Claude for Teachers "provides a
FERPA-configured setting to process student data," "Anthropic will not use your inputs or outputs to
train our models," and district data is returned on request and deleted within 30 days on exit.
Anthropic is careful to say *FERPA-aligned*, not FERPA-compliant, and that "Whether and how
identifiable student information may be used ... is determined by your school or district's
policies, not by Anthropic." **UNVERIFIED — and this is the key open question for VisionQuest:
whether the K-12 DPA can be attached to *API* usage.** The Claude for Teachers article is scoped to
the Teachers product and makes no mention of API applicability. Worth one email: "can the K-12 DPA
attach to our Claude API organization?"

**Alternative routes:** Claude via AWS Bedrock and via Google Cloud — on both, per Anthropic's own
docs, **"the cloud provider is the data processor"**, so you inherit AWS's or Google's DPA and
compliance program rather than Anthropic's, and `inference_geo` is replaced by the endpoint/inference
profile. This is the useful trick: it lets you buy Claude under a DPA you may already have.

Pricing (https://platform.claude.com/docs/en/about-claude/pricing): **Claude Haiku 4.5 $1/MTok in,
$5/MTok out**; Sonnet 5 $2/$10; Opus 5 $5/$25. Batch API 50% off. US-only residency ×1.1.

---

## 3. OpenAI

**API data usage — https://developers.openai.com/api/docs/guides/your-data:**
> "As of March 1, 2023, data sent to the OpenAI API is not used to train or improve OpenAI models
> (unless you explicitly opt in to share data with us)."

Abuse-monitoring retention: "up to 30 days, unless longer retention is required by law."

**ZDR and Modified Abuse Monitoring are approval-gated:**
> "currently, these controls are subject to prior approval by OpenAI and acceptance of additional
> requirements"

with the doc directing you to "get in touch with our sales team to learn more about these offerings
and inquire about eligibility." Under ZDR the `store` parameter for `/v1/responses` and
`/v1/chat/completions` "will always be treated as `false`." Modified Abuse Monitoring "excludes
customer content (other than image and file inputs in rare cases)" from abuse logs while keeping
other functionality. Eligible endpoints include `/v1/chat/completions`, `/v1/responses`,
`/v1/embeddings`, `/v1/audio/transcriptions`, `/v1/moderations`.

**NYT preservation order — resolved, verify once more before quoting.** The order requiring OpenAI to
preserve output log data has been terminated: OpenAI's preservation obligation under the earlier
order ended 2025-09-26, and Judge Ona T. Wang's 2025-10-09 order freed OpenAI from the obligation to
"preserve and segregate all output log data that would otherwise be deleted on a going forward
basis." API data is back to the standard ~30-day deletion. OpenAI stated throughout that **ZDR API
customers were never in scope**. The underlying copyright case is still live (discovery; NYT still
seeking a specific April–September 2025 data set). **UNVERIFIED: I could not load
openai.com/enterprise-privacy (HTTP 403) or the primary court docket** — the order dates above come
from press coverage of the docket, not from the docket itself. This is settled enough to plan around
but should be re-confirmed in writing if it ends up in a compliance memo.

**DPA is effectively self-serve:** OpenAI publishes a DPA (openai.com/policies/data-processing-addendum/,
updated 2025-12-01, effective 2026-01-01) executed from platform.openai.com → Settings →
Organization → compliance/data controls, returning a countersigned PDF.

**ChatGPT Edu** is processed under OpenAI's Student Data Privacy Agreement; ChatGPT Enterprise/Edu
"can satisfy FERPA conditions if the contracting school district or institution has a written
agreement that imposes the FERPA restrictions on the vendor." **UNVERIFIED: whether OpenAI will
extend a student-data agreement to *API* customers at VisionQuest's scale.** Same open question as
Anthropic's K-12 DPA.

---

## 4. Microsoft Azure OpenAI / Microsoft Foundry

**Source: https://learn.microsoft.com/en-us/azure/ai-foundry/responsible-ai/openai/data-privacy
(ms.date 2026-05-18).** The commitment block is unusually explicit:
> "Your prompts (inputs) and completions (outputs), your embeddings, and your training data:
> - are NOT available to other customers.
> - are NOT available to OpenAI or other providers of Models sold by Azure.
> - are NOT used by providers of Models sold by Azure to improve their models or services.
> - are NOT used to train any generative AI foundation models without your permission or instruction.
> - Customer Data, Prompts, and Completions are NOT used to improve Microsoft or third-party products
>   or services without your explicit permission or instruction."

and
> "The models are stateless: no prompts or completions are stored in the model. Additionally, prompts
> and completions are not used to train, retrain, or improve the base models."

Abuse monitoring: flagged prompts/completions may be sampled; automated (LLM) review by default with
human review where confidence is low. The abuse store is "logically separated by customer resource"
and "a customer's prompts and generated content are stored in the Azure geography where the
customer's Foundry resource is deployed." Human reviewers use Secure Access Workstations with
Just-In-Time approval.

**Opting out ("modified abuse monitoring") — form, not toggle.** Per
https://learn.microsoft.com/en-us/azure/ai-foundry/openai/concepts/abuse-monitoring:
> "Microsoft allows customers who meet additional Limited Access eligibility criteria to apply to
> modify abuse monitoring by completing this form."

(customervoice.microsoft.com Limited Access form; "Some advanced Models sold by Azure may have more
stringent criteria for turning off abuse monitoring.") Once approved, "the data storage and human
review process described above is not performed," and you can **verify it yourself** — the resource's
JSON view / `az cognitiveservices account show` exposes `{"name":"ContentLogging","value":"false"}`,
which appears *only* when logging is off. That verifiability is a genuine differentiator; no other
vendor here lets you assert your own privacy posture from an API call.

Residency: standard deployments process in the customer-specified geography. Global deployments do
not. **DataZone**:
> "If you create a DataZone deployment in a Foundry resource located in the United States, prompts
> and responses may be processed anywhere within the United States."

Data at rest — including the abuse store — stays in the customer-designated geography even for
Global/DataZone.

**FERPA — Microsoft has the clearest statement of any vendor here.** Source:
https://learn.microsoft.com/en-us/compliance/regulatory/offering-ferpa:
> "FERPA doesn't require or recognize audits or other certifications, so any academic institution
> that is subject to FERPA must assess for itself whether and how its use of a cloud service affects
> its ability to comply with FERPA requirements. In the Online Services Terms Data Protection
> Addendum (DPA), Microsoft agrees to be designated as a 'school official' with 'legitimate
> educational interests' in customer data as defined under FERPA. Customer data includes any student
> records provided through a school's use of Azure. When Microsoft handles student education records,
> Microsoft agrees to abide by the limitations and requirements imposed by 34 CFR 99.33(a) just as
> school officials do."

In-scope list explicitly includes **"Azure and Azure Government."** Azure also publishes a FERPA
implementation guide and a FERPA control mapping. **Caveat to check: the in-scope list names "Azure"
generically and was last content-dated 2024-11-04; I did not find a line item naming Azure
OpenAI / Foundry specifically.** Reasonable reading is that Foundry is an Azure service and therefore
in scope (the data-privacy page itself says "Foundry is an Azure service"), but **UNVERIFIED** as an
explicit statement.

**Model catalog in Foundry (2026):** "Models sold by Azure" (Microsoft is the processor, Microsoft
SLA, Azure billing) covers Azure OpenAI GPT-5.6 family plus selected xAI Grok, DeepSeek, Meta Llama,
Mistral, Cohere, and Microsoft Phi/MAI. **Anthropic Claude is a *partner* model** — GA in Foundry
July 2026 (Opus 4.8, Sonnet 5, Haiku 4.5), in two hosting variants ("hosted on Azure" vs "hosted on
Anthropic infrastructure"), billed in Claude Consumption Units via Azure Marketplace; on the
Azure-hosted variant the **US Data Zone Standard** deployment type keeps inference in the US (×1.1).
**Gemma and Gemini: I found no evidence Google models are in the Foundry catalog — UNVERIFIED
(absence of evidence).** Llama and Mistral are present. Note the sold-by/partner distinction is
load-bearing: the quoted no-training block above is scoped to "Models sold by Azure," so a partner
model may sit under the provider's terms instead.

---

## 5. AWS Bedrock

**This has the strongest *default* of anyone.** Source:
https://docs.aws.amazon.com/bedrock/latest/userguide/abuse-detection.html
> "Amazon Bedrock uses a zero operator access (ZOA) data security model. This means no operators of
> the service can access model input or output. Also, Amazon Bedrock uses a zero data retention (ZDR)
> data security model. This means that by default, Amazon Bedrock does not store model inputs or
> outputs."

Model providers are structurally walled off (data-protection.html):
> "Because the model providers don't have access to those accounts, they don't have access to Amazon
> Bedrock logs or to customer prompts and completions."

**Retention is now a first-class, IAM-enforceable API setting.** Per
https://docs.aws.amazon.com/bedrock/latest/userguide/data-retention.html there are modes
`none < default < aws_review < provider_data_share`, set per account (`PUT /v1/data_retention`) or
per project, with `inherit` as the new default. `none` = "Zero data retention. No request or response
data is written to durable storage by AWS or shared with the model provider." And crucially you can
**pin it organisation-wide with an SCP**:

```json
{"Effect":"Deny",
 "Action":["bedrock-mantle:PutAccountDataRetention","bedrock-mantle:CreateProject","bedrock-mantle:UpdateProject"],
 "Condition":{"StringNotEquals":{"bedrock-mantle:DataRetentionMode":"none"}}}
```

That is the only mechanism in this whole survey where "we do not retain student data" is enforced by
infrastructure rather than by a promise plus a habit. For a program that has to demonstrate control
to an auditor, that is worth a lot.

Trade-off, same as on the Claude API: **the newest Anthropic models require retention.** Claude Fable
5 and 5.1 declare `allowed_modes: ["aws_review","provider_data_share"]`, so under `none` they show
`status: "unavailable"` and requests are blocked. Under `aws_review`, "user prompts and completions
are retained within the AWS boundary for up to 30 days and may be reviewed by AWS." Older Claude
models (e.g. Opus 4.8) permit `none`. Some OpenAI GPT-5.x models on Bedrock retain classifier-flagged
traffic up to 30 days, with full ZDR available to "eligible customers ... through their AWS account
team." Cross-region inference stores retained data in the *destination* region.

Region: standard AWS regional service; combine with an SCP restricting regions to US.

**FERPA:** AWS publishes a *FERPA Compliance on AWS* resource guide (d1.awsstatic.com whitepapers,
most recent version I can confirm is **August 2024**, covering 24 services) stating that "AWS acts as
a school official when it performs an institutional service for which the School would otherwise use
employees and is under the direct control of the School with respect to the use and maintenance of
education records." **UNVERIFIED: whether Bedrock is one of the services enumerated in the current
whitepaper** — I did not open the PDF, and the 2024 vintage predates much of Bedrock's current
surface. FERPA is also not one of the "services in scope by compliance program" pages AWS maintains
(those cover SOC, FedRAMP, HIPAA, etc.), so FERPA on AWS is a whitepaper + contract story, not a
scope-list story. Bedrock is HIPAA-eligible and covered by the AWS BAA.

Catalog: Claude (full line), OpenAI GPT-5.x, Meta Llama, Mistral, Amazon Nova, and others.
**UNVERIFIED: Gemma availability on Bedrock.**

---

## 6. Open-weight hosts — "local-model privacy at cloud speed"

This is the most interesting category for VisionQuest, because the FERPA-local-only routing rule in
`.claude/rules/sage-ai.md` exists to avoid sending student records to a cloud model at all. A host
with contractual ZDR + no-training + US-only running Gemma/Llama is *functionally* the local path
with none of the Ollama operational pain (see the 9-minute-p50 classroom projection in MEMORY.md).

### Groq — the standout, and the only true self-serve ZDR I found

Source: https://console.groq.com/docs/your-data
> "By default, Groq does not retain customer data for inference requests."

Temporary logging for reliability/abuse investigation is kept "up to 30 days, unless legally required
to retain longer" — **and you can turn that off yourself**:
> "Organization admins can decide to enable ZDR globally or on a per-feature basis at any time on the
> Data Controls page."

US processing, stated plainly:
> "All customer data is retained in Google Cloud Platform (GCP) buckets located in the United States"

DPA is published as a standing document (console.groq.com/docs/legal/customer-data-processing-addendum)
with an audit-report clause ("e.g., SOC 2 or similar audit reports issued by a qualified third-party
auditor") and 180-day deletion on termination. SOC 2 Type II. Trust Center at trust.groq.com.
**No FERPA statement found — UNVERIFIED/absent.** Latency is the best in class: TTFT ~120–180 ms,
throughput in the hundreds of tok/s. Pricing: Llama 4 Scout $0.11/$0.34 per MTok, gpt-oss-20b
$0.075/$0.30, gpt-oss-120b $0.15/$0.60. **Caution: as of 2026-08-26 Llama 3.1 8B Instant and Llama
3.3 70B Versatile reportedly moved to Enterprise-only "contact sales" pricing** — verify current
catalog before designing around a specific model. **UNVERIFIED: Gemma 3/4 on Groq today** (Gemma 2
was there historically; I could not confirm Gemma 3).

### Together AI

Source: https://www.together.ai/privacy
> "We do not use any data collected from you to train our models without your explicit opt-in and
> consent."

ZDR is a **self-serve setting** ("Settings > Profile"); when on, prompts/responses "are not stored,
retained, or used for training or secondary purposes." Forward-looking only. SOC 2 Type 2; HIPAA and
dedicated data residency offered on enterprise tiers. **UNVERIFIED: published DPA and subprocessor
list** — the privacy policy does not mention a DPA, and at least one third-party review says Together
publishes neither. **US-only is not guaranteed in the policy**, which says data "may be transferred
to, and maintained on, computers located outside of your state, province, country." That last point
disqualifies it for a strict US-processing requirement unless enterprise residency is purchased.
Pricing ≈ Llama 3.3 70B $0.88/MTok; small Llamas $0.10–0.18.

### Fireworks AI

Source: https://docs.fireworks.ai/guides/security_compliance/data_security
> "Fireworks does not log or store prompt or generation data for open models, without explicit user
> opt-in."

Stated to apply to both serverless and dedicated inference. HIPAA with BAA support; SOC 2 Type II,
ISO 27001 / 27701 / 42001. Trust center at trust.fireworks.ai. "US-only Serverless" is referenced as
an option. **UNVERIFIED: default data location without the US-only option, self-serve DPA, and
whether BAA/US-only require an enterprise contract.** Pricing ≈ Llama 3.3 70B $0.90/MTok.

### Others (weaker sourcing — treat as leads, not findings)

- **Cerebras** — SOC 2 and HIPAA reported; fastest raw throughput (~525 tok/s on Qwen 3 235B),
  TTFT ~120–150 ms. **UNVERIFIED: ZDR terms, DPA, US-only** (secondary sources only).
- **DeepInfra** — cheapest of the group (Llama 8B ~$0.06/MTok; Llama 3.3 70B ~$0.23/$0.40); reported
  SOC 2 + ISO 27001, "zero retention on inference (only metadata logged)"; hosts Gemma 3.
  **UNVERIFIED: all of it — secondary sources only, I did not reach a Deepinfra terms page.**
- **Baseten** — reported ZDR-capable, no training, BYOC (runs in your VPC), enterprise compliance
  posture. **UNVERIFIED — secondary only.** BYOC is the interesting property here: it collapses the
  processor question, because the weights run in infrastructure you already have a DPA for.
- **Modal, RunPod, Lambda** — these are GPU/compute platforms, not inference-terms vendors: you are
  running the model yourself, so the privacy story is your own plus the platform's infra DPA. **Not
  researched in depth this pass.**
- **Vertex Model Garden / Cloud Run GPU** — same shape on Google: self-hosted Gemma under the Cloud
  DPA, which is auto-incorporated (see §1b). Attractive precisely because it needs no new vendor
  relationship. **UNVERIFIED: Cloud Run GPU regional availability and cold-start behaviour for a
  Gemma-class model**, which is the thing that would decide whether it can serve interactive chat.

### OpenRouter (routing layer, not a host)

Source: https://openrouter.ai/docs/guides/features/zdr
> "Zero Data Retention (ZDR) means that a provider will not store your data for any period of time."
> "OpenRouter itself has a ZDR policy; your prompts are not retained unless you specifically opt in
> to prompt logging."

Enforceable **globally, per model group, per guardrail, or per request** via
`{"provider": {"zdr": true}}`. Limit:
> "ZDR enforcement only applies to provider routing for inference requests. It does not apply to
> plugins and tools you choose to enable, such as web search."

Honest assessment for VisionQuest: this is a good *capability* and a poor *compliance instrument*.
Your counterparty is OpenRouter; the actual processor is whichever provider it routed to that
millisecond, chosen from a set that changes. For a FERPA school-official designation you need a
named, stable processor and a subprocessor list — routing is the opposite of that. Excellent for
evals and bake-offs; not what I'd put student records through.

---

## 7. Privacy-attested inference (confidential computing)

**Is it usable by a small team in 2026? Partly — but not in the form VisionQuest would want.**

- **Azure confidential VMs with NVIDIA H100** (NCC H100 v5) — **generally available**, Intel TDX host
  + NVIDIA Hopper Confidential Computing, memory encrypted, PCIe traffic to the GPU encrypted,
  CPU+GPU jointly produce an Intel-signed attestation report. Regions: East US2 and West Europe.
  ~$5.60/hr as of April 2026. That is **~$4,000/month for one always-on GPU** — well past this
  program's budget for an app whose whole point is a cheap chat coach, unless it is duty-cycled hard.
- **Google Cloud confidential VMs with H100** (A3 machine series) — GA; **Ubuntu is currently the
  only OS supporting confidential GPU on Google Cloud**, which constrains the image you can build.
- **Tinfoil** (tinfoil.sh) — self-serve API key, SOC 2 compliant per their footer, "Every request is
  encrypted directly to an attested secure enclave, verified client-side." **UNVERIFIED: model list,
  pricing, retention terms, HIPAA** — their marketing page carries none of it and I did not reach the
  docs. This is the most plausible small-team confidential option and deserves a direct look.
- **Edgeless Privatemode** — end-to-end encrypted with remote attestation, zero-trust against
  Edgeless itself. **Hosted in the EU** — which is the wrong answer for a US-processing requirement,
  so rule it out here on residency alone.
- **Apple Private Cloud Compute** — concept only; no third-party developer inference API.
- **NVIDIA confidential computing** — the enabling technology under Azure/GCP above, not a service.

**What it adds over contractual ZDR:** ZDR is a promise plus an audit; confidential computing is a
*technical* claim you can verify cryptographically before sending data — the operator cannot read the
data even if it wanted to, and attestation proves which model and runtime is serving you. It converts
"we don't look" into "we can't look."

**Honest verdict for VisionQuest: not yet, and probably not needed.** The threat model confidential
computing addresses (a malicious or compromised cloud operator) is not the one FERPA is worried
about; FERPA is worried about disclosure without a school-official designation and about secondary
use. Contractual ZDR + a DPA addresses that at roughly 1/50th the cost. Revisit if SPOKES ever wants
to process something genuinely adversarial, or if Tinfoil's pricing turns out to be per-token rather
than per-GPU-hour.

---

## (A) Comparison table

Est. cost is for the cheapest sensible "Flash/Haiku-class" chat model on each. Latency class:
**A** = sub-200 ms TTFT, **B** = ~0.3–0.6 s, **C** = ~1 s+ / variable.

| Vendor (route) | Trains on inputs? | Default retention | ZDR self-serve? | DPA self-serve? | FERPA statement? | US region? | BAA? | ~$/1M input | Latency |
|---|---|---|---|---|---|---|---|---|---|
| **Google Gemini Dev API — unpaid** | **YES** + human review | indefinite for product improvement | No | No | No | No control | No | $0 | B |
| **Google Gemini Dev API — paid (billing on)** | No | "limited period" for abuse (days UNVERIFIED); 30d if Search grounding | No — approval req., mechanism UNVERIFIED | Via Google Cloud terms | **No** (Google's FERPA commitment is Workspace-for-Education-scoped) | Not controllable on this endpoint | No | **$0.25** (3.1 Flash Lite) | B (~0.38 s TTFT) |
| **Google Vertex AI (Gemini)** | No | abuse logs + up to 24h prompt cache | No — form/invoiced billing (UNVERIFIED) | **Yes — CDPA auto-incorporated** | **No** (same gap) | **Yes**, regional/US-multi-region endpoints (not `global`) | Yes (GCP BAA) | ~$0.25 + region premium | B |
| **Anthropic Claude API** | **No — contractual** | **None by default** for conversation content; 30d for Covered Models; 2y if flagged | No — sales | **Yes — auto-incorporated** | K-12 DPA exists but **UNVERIFIED for API** | **Yes — `inference_geo:"us"`, workspace-enforceable** (×1.1) | **Yes — self-serve in Console** | **$1.00** (Haiku 4.5) | B |
| **OpenAI API** | No (opt-in only) | 30 days abuse | No — approval + sales | **Yes** (Console-signed PDF) | Edu/Enterprise SDPA; **UNVERIFIED for API** | Data residency for business customers | Yes | ~$0.25–0.50 class (UNVERIFIED exact) | B |
| **Azure OpenAI / Foundry** | **No — explicit 5-point block** | 30d abuse store, in your geography; **verifiable off** via `ContentLogging:false` | No — Limited Access **form** | Yes — Product Terms DPA applies on subscribe | **YES — "school official," Azure named in scope** | **Yes — US DataZone / standard regional** | Yes | GPT-mini class, ~$0.15–0.60 (UNVERIFIED exact) | B |
| **AWS Bedrock** | **No — provider walled off** | **None by default (ZOA+ZDR)**; 30d only for models requiring `aws_review` | **Yes — `data_retention_mode:"none"` API + SCP-enforceable** | Yes — AWS DPA/service terms | Whitepaper "school official"; **Bedrock in scope UNVERIFIED** | Yes — regional + SCP | Yes | Nova/Haiku class, ~$0.06–1.00 | B |
| **Groq** | **No** | **None for inference by default**; ≤30d troubleshooting logs, **switchable off** | **YES — Data Controls page, any customer** | Yes — published DPA | No | **Yes — "GCP buckets located in the United States"** | UNVERIFIED | **$0.075–0.11** (gpt-oss-20b / Llama 4 Scout) | **A (~120–180 ms)** |
| **Together AI** | No (opt-in only) | unspecified | **Yes — Settings > Profile** | UNVERIFIED (not published) | No | **No** — policy permits transfer outside country | Enterprise HIPAA | ~$0.10–0.18 (small Llama) | B |
| **Fireworks AI** | No (opt-in only) | **None for open models** | Effectively default-on (no opt-in = no logging) | UNVERIFIED | No | "US-only Serverless" option; default UNVERIFIED | **Yes (Enterprise BAA)** | ~$0.10–0.90 | B |
| **Cerebras / DeepInfra / Baseten** | reported no | reported ZDR-capable | UNVERIFIED | UNVERIFIED | No | UNVERIFIED | Cerebras HIPAA reported | $0.06–0.60 | A–B |
| **OpenRouter** | No (routes to ZDR-only when flagged) | none itself | **Yes — toggle + `provider.zdr`** | UNVERIFIED | No | Residency routing exists; not a processor you can name | No | passthrough | B |
| **Azure/GCP confidential GPU** | N/A (you host) | you control | N/A | inherited | inherited | Yes | inherited | **~$5.60/GPU-hr** | B–C |

---

## (B) Ranked shortlist for VisionQuest

The constraint that matters most: the app is built on Google's SDK with SSE streaming, the team is
one person plus agents, and the spend ceiling is low five figures. A recommendation that requires
rewriting the provider layer *and* a sales cycle is a recommendation that will not happen.

### 1. Stay on Gemini, but move to Vertex AI with pinned US region — and fix the API-key story first

**Why first:** it is the only option where the code change is roughly a constructor argument. The
`@google/genai` SDK talks to both backends from one client — `new GoogleGenAI({ vertexai: true,
project, location })` instead of an API key — and `generateContentStream` is the same method either
way, so the SSE plumbing in `/api/chat/send` is untouched. You gain: an **auto-incorporated Cloud
DPA** (no signature, no sales call), a **named US region** with ML processing pinned there, a
subprocessor list, a breach-notice clause, IAM/audit logging, and a path to ZDR via the abuse-monitoring
exception. Cost is roughly unchanged.

**Honest trade-off:** Google will *not* give you a FERPA school-official commitment for Vertex — that
commitment is written for Workspace for Education. You would be relying on the CDPA's
processor-on-instruction terms to satisfy §99.31(a)(1)(i)(B) yourself, which is a defensible position
and a common one, but it is a position you argue rather than a document you cite. Also: Vertex ZDR is
two moving parts (disable caching, obtain the abuse exception) and I could not verify the exception
mechanism from Google's own page.

### 2. Azure OpenAI / Microsoft Foundry — if the FERPA paperwork is the point

**Why:** Microsoft is the only vendor in this survey that writes down, on its own compliance page,
that it "agrees to be designated as a 'school official' with 'legitimate educational interests' in
customer data as defined under FERPA," names **Azure** in the in-scope list, and commits to 34 CFR
99.33(a). It is also the only one where you can *verify your own privacy configuration from an API
call* (`ContentLogging: false`). US DataZone gives real residency. If WVDE or DoHS ever asks
VisionQuest to produce vendor FERPA documentation for the FY27 review, this is the folder that
answers the question without argument.

**Honest trade-offs:** (a) real migration work — different SDK, different streaming shape, and
`SAGE_PROMPT_REVISION` would need a bump plus a full re-run of the gating red-team and guardrail
evals, because the model changes and the crisis-detection behaviour is model-sensitive; (b) modified
abuse monitoring is a **Limited Access form with eligibility criteria**, and a small nonprofit may
simply not qualify — in which case Microsoft stores flagged prompts for human review, which is
precisely what a crisis-chat transcript should not be; (c) Gemini is not in the Foundry catalog, so
this is a model change, not just a hosting change; (d) Azure billing/ops is a new surface for a
one-person team.

### 3. Groq (or Fireworks) for a hosted Gemma/Llama — the FERPA-local path without the local hardware

**Why:** MEMORY.md already carries the load-test finding that serial Ollama projects ~9 min p50 for
15 concurrent students — the local-only FERPA routing rule is currently written against a path that
cannot serve a classroom. Groq gives self-serve ZDR you flip yourself, default no-retention, US-only
storage stated in plain words, a published DPA with an audit clause, SOC 2 Type II, and TTFT around
120–180 ms — which is *faster than what students get today*. At $0.075–0.11 per million input tokens
this is cheaper than Flash Lite. It would let `resolveAiProvider`'s `student_record` branch route to
a real hosted open-weight model instead of failing open to cloud Gemini (the open VQ-R-002/003
contradiction in MEMORY.md).

**Honest trade-offs:** (a) **no FERPA statement at all** from Groq — you get strong data terms and no
education-specific paper, so the school-official argument is entirely yours to make; (b) an
open-weight model at Gemma/Llama scale is not Gemini 3.1 Flash Lite on instruction-following, and
Sage's tool-calling and crisis behaviour would need the full eval suite re-run before trusting it —
and note the standing finding that **tool selection and boundary behaviour have never been measured
on any local/open model** in this repo; (c) Groq's catalog moves (two Llama models went
enterprise-only in August 2026), so pin a model and monitor; (d) Groq is a startup — vendor-continuity
risk is real for a multi-year grant program. Fireworks is the more conservative sibling: slower, more
certifications (SOC 2 II + ISO 27001/27701/42001), BAA available, "does not log or store prompt or
generation data for open models."

**What I would not recommend:** OpenRouter (no nameable processor), Together (its own policy permits
processing outside the country), and confidential computing (~$4k/month for the wrong threat model).

---

## (C) Concrete steps to get today's Gemini usage onto defensible terms

Ordered by ratio of risk removed to work required.

**Step 0 — today, five minutes, highest value: confirm the API key's project has active Cloud
Billing.** This is the whole ballgame for the current deployment. The paid-tier no-training term is
triggered by "accessing the API through a Cloud Project associated with an active billing account,"
not by paying a bill or by which model you call. If `GEMINI_API_KEY` was minted in AI Studio against a
project with no billing account attached, then **every student chat turn VisionQuest has ever sent is
under the unpaid terms** — content used "to provide, improve, and develop Google products and
services," with human reviewers permitted to read it. Verify in the Cloud Console (the key's project →
Billing → linked account), not by looking at whether an invoice arrived; a project can be inside free
quota and still be billing-linked, and that is the state you want. Write the answer down somewhere
durable — this is exactly the kind of fact the repo's audit history shows getting assumed rather than
checked.

**Step 1 — kill or fence the per-student personal API key path.** This is the finding I would put at
the top of any memo. When a student supplies their own Gemini key, the processing happens under
**that student's own Google terms**, and the consequences stack up badly:

- The student's key is almost certainly an unpaid-tier AI Studio key, so their conversation — which
  includes their own education records, and by design their crisis disclosures — is used to improve
  Google products and is human-reviewable.
- The contracting party is the *student*, not SPOKES. There is no DPA, no processor relationship, and
  no school-official designation, so the disclosure cannot be justified under §99.31(a)(1) at all.
- FERPA's consent exception does not rescue it cleanly either: a student "consenting" to a
  configuration setting inside a program they are enrolled in, at a 6th-grade reading level, is not
  the written, signed, purpose-specific consent §99.30 contemplates.
- It is also invisible to every control the repo already has. The FERPA local-only routing rule, the
  `studentLogKey` no-PII-in-logs sweep, and the RLS work all govern VisionQuest's own path; none of
  them reach a request the app makes to Google on the student's own key.

Recommended: remove the student-key path for `student_record`-class content entirely, or restrict it
to a non-record scope (e.g. generic career Q&A with no student facts in the prompt) with a hard
prompt-construction guard rather than a policy note. If it must survive, the key must be a
program-owned billed key and the "personal key" feature should be re-framed as a rate-limit escape
hatch, not a data-processing choice. Also note the related item already in MEMORY.md that personal
Gemini keys "resolve first" in provider resolution — that ordering means the *least* protected path
wins by default, which is backwards.

**Step 2 — accept the Google Cloud DPA and move the endpoint to Vertex with a pinned US region.**
The API-surface delta is small:

- Client construction changes from an API key to `new GoogleGenAI({ vertexai: true, project: '<gcp
  project>', location: 'us-central1' })` (or a US multi-region endpoint). Auth moves from
  `GEMINI_API_KEY` to ADC / a service account — which means a new Render env var and secret, and a
  new failure mode to handle at boot.
- **Do not use the `global` endpoint.** It silently defeats residency, and there is a live
  google-gemini/gemini-cli issue (#27984) about exactly this: a Vertex client ignoring the configured
  location and using the global endpoint. Pin `location` explicitly and assert it in a test.
- `generateContentStream` and the SSE relay are unchanged. Model ids gain a publisher path form on
  Vertex; the repo's `resolveAiProvider` already centralises model naming per role, so this lands in
  one module.
- Safety settings, tool declarations and `systemInstruction` carry over, but **`SAGE_PROMPT_REVISION`
  should be bumped and the gating red-team + guardrail evals re-run**, per the repo's own standing
  rule — endpoint changes have produced generation shifts before (see the 2026-07-21 safetySettings
  entry in the decisions log).
- Watch two Vertex-specific data behaviours: **implicit prompt caching** (reported up to 24h at
  project level; disable it if you pursue ZDR) and any use of **Grounding with Google Search**, which
  forces 30-day storage with no opt-out and would be an own-goal on a student-record path.

**Step 3 — request the abuse-monitoring logging exception for the project.** This is what converts
"Google doesn't train on it" into "Google doesn't retain it." Route: the Google Cloud abuse-monitoring
exception form or invoiced billing (**UNVERIFIED mechanism — confirm with a Google rep**). Pair it
with disabling caching. Until it is granted, assume prompts are logged for an unstated period.

**Step 4 — get the FERPA question answered in writing, from a human.** Ask Google's public sector /
education team, in one email: *does Google make a FERPA school-official commitment for Vertex AI, or
is that commitment limited to Google Workspace for Education?* My research says the latter, and I
could not read Google's own FERPA page to disprove it. If the answer is "Workspace only," that is a
real input into whether Azure (which does make the commitment, and names Azure in scope) is worth the
migration — and it is a question SPOKES's funder may eventually ask anyway, given the DoHS FY27
review already on the books.

**Step 5 — write down the school-official designation on VisionQuest's own side.** Whichever vendor
wins, FERPA compliance is not delivered by the vendor. SPOKES/WVDE needs: the vendor named in a
written agreement as performing an institutional service, under the institution's direct control,
using records only for the authorised purpose, with no redisclosure; the designation reflected in the
annual FERPA notification; and the DPA on file. This dovetails with the `docs/DATA_RETENTION_POLICY.md`
OWNER-CONFIRM markers already open in MEMORY.md — same document, same signature.

**Step 6 (optional, later) — reconsider the local-only rule with a hosted open-weight option.** The
FERPA local-only routing rule currently fails open to cloud Gemini (VQ-R-002/003, still open), and the
local path it protects cannot serve a classroom. A Groq- or Fireworks-hosted Gemma/Llama under ZDR +
US-only + a signed DPA is arguably *more* defensible than a local Ollama with no contract and no
audit trail, and materially faster. That is a rule change, not a code change, and it belongs to the
owner — but the current state, where the strict rule is satisfied by a path nobody can use and
therefore isn't, is the worst of both.

---

## Explicit list of what I could NOT verify

1. Body text of **cloud.google.com/security/compliance/ferpa** — four fetch attempts returned
   navigation only. Google's FERPA scope for Vertex/Gemini API is therefore inferred, not quoted.
2. **Paid-tier abuse-log retention in days** for the Gemini Developer API. Only the 30-day
   Search/Maps-grounding figure is stated.
3. **The mechanism to request ZDR on the Gemini Developer API** — the doc references approval with no
   form, toggle, or eligibility bar named.
4. **Vertex abuse-monitoring page and Vertex ZDR page** bodies (nav-only responses); the
   form/invoiced-billing route and the 24h cache figure are from search snippets and a practitioner
   post, not my own read.
5. **Gemini 3.1 Flash Lite region×model availability on Vertex.**
6. Whether **Anthropic's K-12 DPA can attach to Claude API** usage (article is Teachers-product-scoped).
7. **openai.com/enterprise-privacy** — HTTP 403. OpenAI's enterprise retention/residency/subprocessor
   claims are from the developer docs only.
8. **NYT preservation-order dates** are from press coverage of the docket, not the docket itself.
9. Whether **Azure OpenAI / Foundry specifically** (vs "Azure" generically) is named in Microsoft's
   FERPA in-scope list; that page's content date is 2024-11-04.
10. Whether **Bedrock** is among the services in AWS's FERPA whitepaper (latest confirmed version
    August 2024, predating much of current Bedrock).
11. **Gemma availability** on Groq (Gemma 2 historically; Gemma 3/4 unconfirmed) and on Bedrock.
12. **DeepInfra, Cerebras, Baseten** — all from secondary sources; no primary terms page reached.
13. **Together AI** DPA and subprocessor list (appear unpublished).
14. **Fireworks** default data location without the US-only option, and whether BAA/US-only need an
    enterprise contract.
15. **Tinfoil** model list, pricing, retention terms, HIPAA status.
16. **Modal / RunPod / Lambda / Cloud Run GPU** — not researched in depth; they are compute platforms
    where the terms question is largely yours, not theirs.
17. Exact current **OpenAI and Azure per-1M-token prices** for the mini/Flash-competitor tier.

## Sources

- https://ai.google.dev/gemini-api/terms
- https://ai.google.dev/gemini-api/docs/zdr
- https://ai.google.dev/gemini-api/docs/pricing
- https://cloud.google.com/terms/data-processing-addendum
- https://cloud.google.com/security/compliance/ferpa (not readable)
- https://docs.cloud.google.com/gemini-enterprise-agent-platform/resources/zero-data-retention (nav only)
- https://www.anthropic.com/legal/commercial-terms
- https://platform.claude.com/docs/en/manage-claude/api-and-data-retention
- https://platform.claude.com/docs/en/manage-claude/data-residency
- https://platform.claude.com/docs/en/about-claude/pricing
- https://privacy.claude.com/en/articles/7996862-how-do-i-view-and-sign-your-data-processing-addendum-dpa
- https://privacy.claude.com/en/articles/15425996-data-retention-practices-for-covered-models
- https://support.claude.com/en/articles/15926041-claude-for-teachers-your-data-and-our-terms
- https://trust.anthropic.com/
- https://developers.openai.com/api/docs/guides/your-data
- https://openai.com/policies/data-processing-addendum/
- https://openai.com/index/response-to-nyt-data-demands/
- https://learn.microsoft.com/en-us/azure/ai-foundry/responsible-ai/openai/data-privacy
- https://learn.microsoft.com/en-us/azure/ai-foundry/openai/concepts/abuse-monitoring
- https://learn.microsoft.com/en-us/compliance/regulatory/offering-ferpa
- https://www.microsoft.com/licensing/docs/view/Microsoft-Products-and-Services-Data-Protection-Addendum-DPA
- https://docs.aws.amazon.com/bedrock/latest/userguide/data-retention.html
- https://docs.aws.amazon.com/bedrock/latest/userguide/abuse-detection.html
- https://docs.aws.amazon.com/bedrock/latest/userguide/data-protection.html
- https://d1.awsstatic.com/whitepapers/compliance/FERPA_Compliance_on-AWS.pdf
- https://console.groq.com/docs/your-data
- https://console.groq.com/docs/legal/customer-data-processing-addendum
- https://trust.groq.com/
- https://www.together.ai/privacy
- https://docs.fireworks.ai/guides/security_compliance/data_security
- https://openrouter.ai/docs/guides/features/zdr
- https://techcommunity.microsoft.com/blog/azureconfidentialcomputingblog/general-availability-azure-confidential-vms-with-nvidia-h100-tensor-core-gpus/4242644
- https://ubuntu.com/blog/ubuntu-confidential-vms-now-available-on-google-cloud-a3-with-nvidia-h100-gpus
- https://tinfoil.sh/inference
- https://www.edgeless.systems/wiki/use-cases/confidential-ai
- https://github.com/google-gemini/gemini-cli/issues/27984
