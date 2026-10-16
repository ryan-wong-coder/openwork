# Gateway reasoning verification

Verified on 2026-10-16. No runtime requests to these documentation/catalog sites are added by this fix.

## Capability sources

The authenticated ModelHelm `GET /v1/models` response contained 70 entries with only `id`, `object`, `created`, and `owned_by`. It advertised no per-model reasoning capability or effort levels. The runtime materializer therefore preserves explicit catalog capability metadata when available, and otherwise uses a conservative offline table for these exact ModelHelm IDs at `https://api.modelhelm.com/v1` only.

| Exact model IDs | Efforts | Source |
| --- | --- | --- |
| `deepseek/deepseek-v4-flash`, `deepseek/deepseek-v4-pro` | none, low, high, max | [DeepSeek Chat Completions contract](https://api-docs.deepseek.com/api/create-chat-completion/), [thinking protocol](https://api-docs.deepseek.com/guides/thinking_mode/) |
| `openai/gpt-5.4` | none, low, medium, high, xhigh | [Exact OpenCode model catalog entry](https://github.com/anomalyco/models.dev/blob/dev/providers/openai/models/gpt-5.4.toml) |
| `openai/gpt-5.4-mini` | none, low, medium, high, xhigh | [Exact OpenCode model catalog entry](https://github.com/anomalyco/models.dev/blob/dev/providers/openai/models/gpt-5.4-mini.toml) |
| `openai/gpt-5.5` | none, low, medium, high, xhigh | [Exact OpenCode model catalog entry](https://github.com/anomalyco/models.dev/blob/dev/providers/openai/models/gpt-5.5.toml) |
| `openai/gpt-5.6-luna` | none, low, medium, high, xhigh, max | [Exact OpenCode model catalog entry](https://github.com/anomalyco/models.dev/blob/dev/providers/openai/models/gpt-5.6-luna.toml) |
| `openai/gpt-5.6-sol` | none, low, medium, high, xhigh, max | [Exact OpenCode model catalog entry](https://github.com/anomalyco/models.dev/blob/dev/providers/openai/models/gpt-5.6-sol.toml) |
| `openai/gpt-5.6-terra` | none, low, medium, high, xhigh, max | [Exact OpenCode model catalog entry](https://github.com/anomalyco/models.dev/blob/dev/providers/openai/models/gpt-5.6-terra.toml) |
| `minimax/minimax-m2`, `minimax/minimax-m2.1`, `minimax/minimax-m2.5`, `minimax/minimax-m2.7` | Built-in reasoning; no adjustable effort | [MiniMax OpenAI-compatible API](https://platform.minimax.io/docs/api-reference/text-openai-api), request parameters and M2.x thinking-control table |

These sources describe the published upstream/model contract. They do not establish live ModelHelm availability or prove that a particular ModelHelm route honors the control. Unknown IDs, alternate namespaces, new releases, and custom gateway endpoints do not inherit this table. No reasoning control is invented by substring matching. Explicit disabled/empty/false declarations and local model configuration remain authoritative.

## Native transport regression

Run each fixture separately with its pinned native executable:

```sh
OPENWORK_TEST_OPENCODE_BIN=/path/to/opencode-1.18.30 bun apps/server/test/fixtures/gateway-reasoning-native-v1.ts
OPENWORK_TEST_OPENCODE2_BIN=/path/to/opencode2-2.0.26 bun apps/server/test/fixtures/gateway-reasoning-native-v2.ts
```

Both real engines emitted OpenAI-compatible Chat Completions bodies with the complete model routing ID and `reasoning_effort: "high"` when the selected native variant was `high`. Each completed two synthetic turns; the second request preserved the first assistant's `reasoning_content`. V1 also went through the real scoped-authentication gateway proxy. No `thinking` field was manufactured. These are normal two-turn transport/replay checks, not a tool-call-loop or model-quality benchmark.

Both fixtures use isolated HOME/XDG state, synthetic credentials, localhost-only upstreams and cleanup in `finally`; they create no desktop window or real external model request.

## Live gateway check limitation

Three authorized minimal synthetic requests were attempted against the configured ModelHelm gateway. Their response content and credentials were not retained:

| Model | Optional effort field | Max output tokens | HTTP result |
| --- | --- | --- | --- |
| `deepseek/deepseek-v4-flash` | `reasoning_effort: low` | 128 | 503, `system_error` |
| `openai/gpt-5.5` | `reasoning_effort: low` | 64 | 503, `system_error` |
| `deepseek/deepseek-v4-flash` | Omitted, same synthetic prompt as the first request | 128 | 503, `system_error` |

The no-effort control also failed. Live gateway generation and acceptance of the reasoning control could therefore not be verified; real calls were stopped. The code fix is supported by native transport, capability-boundary and offline migration regressions, not a claim of a successful live gateway generation.
