# Local Model Task Routing

VisionQuest has an opt-in, deterministic local-model router for Sage. It does
not change production behavior until an administrator explicitly enables it.
It never downloads models, probes a provider during routing, or sends protected
student/staff content to a cloud fallback.

## Candidate roles

| Tier | Default model tag | Work |
| --- | --- | --- |
| Default | `gemma4:12b` | Student-facing coaching, safety/crisis messages, sensitive coaching, and uncertain work |
| Speed | `qwen3.5:9b` | Only a new, de-identified, minimal-context casual chat |
| Quality | `gemma4:26b` | Staff workflows, structured extraction, RAG/grounded answers, and complex application/resume work |

The tags are configuration values, not an instruction to download a model.
Use the exact tags exposed by the configured local provider.

## Staged configuration

All values are non-secret `SystemConfig` entries.

| Key | Default | Meaning |
| --- | --- | --- |
| `ai_local_task_routing_enabled` | `false` | Master rollout switch; only exact `true` enables routing |
| `ai_local_model_default` | `gemma4:12b` | Required Gemma coaching/safety model |
| `ai_local_model_default_available` | `false` | Operator confirmation that the default model is installed and ready |
| `ai_local_model_speed` | `qwen3.5:9b` | Optional Qwen casual-chat model |
| `ai_local_model_speed_available` | `false` | Operator confirmation that the speed model is ready |
| `ai_local_model_quality` | `gemma4:26b` | Optional larger Gemma model |
| `ai_local_model_quality_available` | `false` | Enable only after confirming the host has adequate hardware |

For the planned M4 Mac with 32 GB unified memory, these three tags are the
intended candidates, but VisionQuest does not install, download, or start them.
An operator must provision them in Ollama and use the exact tags returned by
the host inventory.

Do not toggle these keys independently for rollout. Configure the existing
local endpoint and authentication first, leave routing disabled, and call:

`PUT /api/admin/ai-provider/routing`

with an authenticated developer-admin session and:

```json
{
  "defaultModel": "gemma4:12b",
  "speedModel": "qwen3.5:9b",
  "qualityModel": "gemma4:26b",
  "enabled": true
}
```

The endpoint checks the configured local URL, authenticates with the already
stored provider configuration, validates the default chat path, and requires
all three exact tags in the returned inventory. Only then does one database
transaction store the model tags, availability proofs, rollout flag, and an
`admin.ai_local_task_routing.activate` audit row. A failed health or inventory
check writes nothing. This task does not call that endpoint or activate the
rollout.

## Safety and fallback behavior

- With rollout off, the existing `ai_provider` switch and
  `ai_provider_model` behavior are unchanged.
- With rollout on, `student_record` and `staff_entered` requests always use
  the local endpoint even if the legacy switch says `cloud`.
- If the local URL is missing/unsafe or the default Gemma model is not marked
  available, protected work is blocked. Cloud credentials are not resolved.
- Qwen is eligible only for a new student conversation whose exact model
  payload is marked de-identified and contains one allowlisted casual message,
  a generic prompt, and nothing else. It receives no student bundle, history,
  RAG, memory, attachments, staff context, tools, summary, or post-response
  extraction.
- Any protected payload, existing conversation, history, RAG, attachment,
  crisis state, staff context, or uncertain classification uses Gemma.
- If Qwen is unavailable, eligible casual chat falls back to the default Gemma
  model.
- If the quality model is unavailable, quality work falls back to the default
  Gemma model.
- If the quality model fails at runtime, its entire response is discarded
  before caller-visible output. The request is retried once against only the
  default Gemma; the fallback is also buffered to avoid partial mixed-model
  responses. The quality path never falls back to Qwen or cloud.
- Model-family guards require `gemma` in the default/quality tags and `qwen`
  in the speed tag. A bad optional tag falls back to default Gemma; a bad
  default tag blocks routing.
- There is no fallback from Gemma to Qwen and no protected-data fallback to
  cloud.
- Public/program and de-identified work keeps the existing cloud/local policy.

The student-chat classifier is intentionally conservative and deterministic.
Attachments, crisis/safety language, RAG/program questions, sensitive topics,
long or multiline prompts, prompt-injection-shaped text, and anything not on
the exact casual allowlist remain on Gemma. Even an allowlisted phrase remains
on Gemma when it continues an existing conversation.

## Frozen security proof

The adversarial contract and SHA-256 checksums are documented in
`tests/frozen/LOCAL_ROUTING_SECURITY.md`. The frozen tests must not be edited
to accommodate future implementation changes.
