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
| `openai/gpt-6.1-sol` | low, medium (upstream default), high, xhigh, max; no none/minimal | [OpenAI GPT-6.1 Sol model contract](https://developers.openai.com/api/docs/models/gpt-6.1-sol), [reasoning protocol](https://developers.openai.com/api/docs/guides/reasoning) |
| `minimax/minimax-m2`, `minimax/minimax-m2.1`, `minimax/minimax-m2.5`, `minimax/minimax-m2.7` | Built-in reasoning; no adjustable effort | [MiniMax OpenAI-compatible API](https://platform.minimax.io/docs/api-reference/text-openai-api), request parameters and M2.x thinking-control table |
| `anthropic/claude-fable-5`, `anthropic/claude-opus-5`, `anthropic/claude-opus-5.5`, `anthropic/claude-sonnet-5` | Native Claude SDK only: low, medium, high, xhigh, max with adaptive/summarized thinking | [Claude effort contract](https://platform.claude.com/docs/en/build-with-claude/effort), [native gateway endpoint evidence](https://modelhelm.com/), authenticated observations below |

These sources describe the published upstream/model contract. They do not establish live ModelHelm availability or prove that a particular ModelHelm route honors the control. Unknown IDs, alternate namespaces, new releases, and custom gateway endpoints do not inherit this table. No reasoning control is invented by substring matching. Explicit disabled/empty/false declarations and local model configuration remain authoritative.

## Native transport regression

Run each fixture separately with its pinned native executable:

```sh
OPENWORK_TEST_OPENCODE_BIN=/path/to/opencode-1.18.30 bun apps/server/test/fixtures/gateway-reasoning-native-v1.ts
OPENWORK_TEST_OPENCODE2_BIN=/path/to/opencode2-2.0.26 bun apps/server/test/fixtures/gateway-reasoning-native-v2.ts
```

Both real engines emitted OpenAI-compatible Chat Completions bodies with the complete model routing ID and `reasoning_effort: "high"` when the selected native variant was `high`. Each completed two synthetic turns; the second request preserved the first assistant's `reasoning_content`. V1 also went through the real scoped-authentication gateway proxy. No `thinking` field was manufactured. These are normal two-turn transport/replay checks, not a tool-call-loop or model-quality benchmark.

Both fixtures use isolated HOME/XDG state, synthetic credentials, localhost-only upstreams and cleanup in `finally`; they create no desktop window or real external model request.

### GPT-6.1 follow-up

The ModelHelm catalog contains the complete `openai/gpt-6.1-sol` routing ID without capability fields. The earlier exact fallback table omitted this ID, so neither discovery nor startup migration could advertise its effort controls. The added exact entry follows OpenAI's five supported efforts, disables both unsupported values explicitly, and applies only at the default ModelHelm URL. Explicit remote/local reasoning or variants declarations still win. Custom gateway URLs and similar-looking aliases receive no inferred capability.

OpenAI requires Responses for direct GPT-6.1 Sol tool calling; its direct Chat Completions contract supports requests without tools. Zeno's existing ModelHelm GPT provider and scoped proxy use Chat Completions. A local synthetic transport test proves that the engine emits the selected effort through this route; it does not alone establish gateway tool translation, upstream tool support, or remote effort enforcement. The live gateway follow-up below adds that route's specific evidence. GPT-6.1 retains its existing protocol; the later Claude-native integration is separate.

The V1 fixture can additionally select the exact GPT-6.1 model and exercise `high` then `max`:

```sh
OPENWORK_TEST_REASONING_MODEL=openai/gpt-6.1-sol OPENWORK_TEST_OPENCODE_BIN=/path/to/opencode-1.18.30 bun apps/server/test/fixtures/gateway-reasoning-native-v1.ts
```

Executed successfully with pinned V1 1.18.30 and V2 2.0.26 on 2026-10-16. Both native catalogs advertised precisely `low`, `medium`, `high`, `xhigh`, `max`; separate selected `high`/`max` turns emitted the corresponding `reasoning_effort` with complete `openai/gpt-6.1-sol` IDs to synthetic localhost endpoints. V1 exercised the authenticated scoped gateway proxy. The V2 fixture also retained its original two-turn generic reasoning replay and built-in/no-dial checks. These checks made zero external model calls and do not claim native GPT-6.1 tool execution or remote effort enforcement.

At the GPT-6.1-only follow-up stage, the related six-file gateway regression passed 52 tests / 331 assertions, including both offline migration paths and two-start preservation of GPT-6.1 explicit configuration for default/custom URLs. Frontend checks ran in separate Bun processes: 9 primitive UI tests / 34 assertions and the real V2 adapter test / 16 assertions; the latter maps materialized GPT-6.1 metadata through native variant rendering, public V2 normalization and `runtimeModelOptions` to five adjustable levels. Server and app TypeScript checks also passed. Later Claude-native integration adds its own coverage below.

### Authenticated GPT-6.1 gateway follow-up

The release operator performed a later authenticated check against the configured ModelHelm gateway on 2026-10-16. The refreshed catalog returned HTTP 200 with 70 entries and still omitted reasoning capability metadata. Using the same small synthetic math question for the two successful Chat Completions calls produced these sanitized observations:

| Exact model ID | Protocol / selected effort | HTTP result | Observed result |
| --- | --- | --- | --- |
| `openai/gpt-6.1-sol` | Chat Completions, `reasoning_effort: low` | 200 | Answer present; `reasoning_tokens: 58` |
| `openai/gpt-6.1-sol` | Chat Completions, `reasoning_effort: high` | 200 | Answer present; `reasoning_tokens: 68` |
| `openai/gpt-6.1-sol` | Chat Completions, deliberately invalid effort | 400 | Validation identified exactly low, medium, high, xhigh, max as valid levels |
| `openai/gpt-6.1-sol` | Responses, `reasoning.effort: low` | 200 | Simple answer present; no tools requested |

This establishes live acceptance of valid GPT-6.1 effort controls and rejection of an undocumented value on the existing ModelHelm Chat Completions route. Token counts are observations from one synthetic comparison, not a reasoning-quality benchmark or a guarantee about token usage. No credentials, request IDs, full upstream error bodies, prompts or answer text are retained in this record.

The four calls in that batch did not exercise tool calling. The successful no-tool Responses call alone does not establish agent/tool compatibility and does not justify automatically migrating existing providers to Responses. The later two-round Chat Completions tool check below adds specific ModelHelm compatibility evidence; OpenAI's direct-API protocol requirements remain separate.

The operator subsequently tested the current ModelHelm Chat Completions route with the complete `openai/gpt-6.1-sol` ID, `reasoning_effort: low`, one synthetic `calculate` tool and automatic tool choice. Round one returned HTTP 200 with `finish_reason: tool_calls` and exactly one matching tool call. Round two replayed the returned assistant message plus a synthetic tool result and returned HTTP 200 with `stop` and a matching final answer. Both reported zero reasoning tokens on the simple synthetic task. No raw prompt, tool arguments, answer content or request IDs are retained here.

This is a verified raw-gateway two-round tool compatibility check, not a claim that OpenAI's direct Chat Completions API supports GPT-6.1 tools, nor a benchmark of every tool or long-running chain. The local native fixtures' no-tool GPT-6.1 checks remain scoped to transport/capability verification and do not negate this later raw-gateway observation. The current gateway route is retained, and no speculative migration to Responses is needed for this evidence.

## Claude native-protocol investigation

This is a later, separate authenticated operator investigation on 2026-10-16, after both the initial 503 batch and the GPT-6.1 follow-up. It records protocol findings for native integration work; it does not add Claude models to the OpenAI `reasoningEffort` fallback table.

### Official parameter contract

[Claude's effort documentation](https://platform.claude.com/docs/en/build-with-claude/effort) defines `output_config.effort`; Claude Sonnet 5 and Claude Opus 5.5 support low, medium, high, xhigh and max. The latter uses adaptive thinking by default. These are Claude-native controls, separate from an OpenAI-compatible request field.

[Claude's OpenAI SDK compatibility documentation](https://platform.claude.com/docs/en/cli-sdks-libraries/libraries/openai-sdk) explicitly lists `reasoning_effort` as ignored, explains that unsupported parameters may be silently ignored, and directs full thinking support to the native Claude API. Therefore a successful Claude Chat Completions response alone does not establish that the effort parameter was applied.

### Sanitized live observations

The [official ModelHelm homepage](https://modelhelm.com/) publishes a separate Claude protocol example at `/claude/v1/messages`. Its homepage module, [the inspected public JavaScript chunk](https://modelhelm.com/assets/index-BtXLM18R.js), combines that route with `siteInfo.server_address`; [the public site status endpoint](https://modelhelm.com/api/status) supplied `https://api.modelhelm.com` when inspected on 2026-10-16. This establishes the gateway URL below, not its authentication contract. Header behavior and full prefixed model IDs are established by the authenticated probes, separately from the public homepage example. The cached public HTML/JavaScript/status evidence is in ignored `tmp/modelhelm-public-research/`; the chunk filename may change on a later site deployment.

The successful native route was `POST https://api.modelhelm.com/claude/v1/messages`, with an `x-api-key` credential header and `anthropic-version` header. Complete ModelHelm routing IDs were retained in the body: `anthropic/claude-sonnet-5` and `anthropic/claude-opus-5.5`. Native effort was sent as `output_config.effort`, with adaptive thinking. No credentials, request IDs, full error bodies, reasoning text, prompts or answer text are retained here.

| Model / route | Control | HTTP result | Sanitized observation |
| --- | --- | --- | --- |
| `anthropic/claude-sonnet-5`, native `/claude/v1/messages` | `output_config.effort: low` and `high` | 200 for each | Native requests accepted |
| `anthropic/claude-sonnet-5`, native `/claude/v1/messages` | Deliberately invalid native effort | 400 | Valid levels identified as low, medium, high, xhigh, max |
| `anthropic/claude-opus-5.5`, native `/claude/v1/messages` | `output_config.effort: low` and `high` | 200 for each | High returned both thinking and text blocks; observed thinking-token count 32 |
| `anthropic/claude-opus-5.5`, native `/claude/v1/messages` | Deliberately invalid native effort | 400 | Valid levels identified as low, medium, high, xhigh, max |
| `anthropic/claude-sonnet-5`, OpenAI-compatible `/v1/chat/completions` | `reasoning_effort: low`, `high`, and a deliberately invalid value | 200 for each | Invalid effort was not rejected; synthetic math checks at a 384-token limit ended with `length`, zero reported reasoning tokens and no `reasoning_content` |
| Claude native request sent to the different `/v1/messages` path | Native adaptive thinking and output effort | 404 | Wrong route; this did not test the separately published Claude entry |
| `anthropic/claude-opus-5`, native `/claude/v1/messages` | `output_config.effort: low`, adaptive/summarized; output limit 128 | 200 | Text and `end_turn`; response identified `claude-opus-5` |
| `anthropic/claude-fable-5`, native `/claude/v1/messages` | `output_config.effort: low`, adaptive/summarized; output limit 128 | 200 | Text and `end_turn`; response identified `claude-fable-5` |
| `anthropic/claude-sonnet-5`, native streaming `/claude/v1/messages` | `output_config.effort: xhigh` | 200 | Complete message/content-block/delta/stop event sequence; no parse error; text-only on a simple task, zero thinking tokens |
| `anthropic/claude-opus-5.5`, native streaming `/claude/v1/messages` | `output_config.effort: xhigh` | 200 | Complete event sequence; no parse error; thinking and text, thinking-token count 32 |
| `anthropic/claude-opus-5.5`, native V2 per-message effort format | High effort in a system message's `output_config`, no top-level output config; pinned SDK beta headers and thinking block binding retained | 200 | `end_turn` and text present; strict integer-answer comparison did not match, so this probe does not claim answer correctness |
| `anthropic/claude-opus-5.5`, same V2 per-message format | Deliberately invalid effort in the system message's output config | 400 | Validation identified `messages.0.output_config.effort` and the exact five accepted levels |

The native route validates effort values and can return native thinking blocks. The Chat Completions negative control agrees with the official compatibility limitation; its HTTP 200 must not be used to manufacture Claude `reasoningEffort` variants. Neither this native simple-message probe nor the compatibility comparison establishes a full tool-call/result loop or native client integration. Existing provider configuration is not automatically migrated to a different protocol by this evidence record.

For an authorized reproduction, keep credentials in private environment storage; select the separate Claude base route; preserve the full catalog model ID; send native `output_config.effort` and adaptive thinking with both required header names above. Compare low/high with one invalid-effort control using synthetic input. Retain only status, accepted-level names, block types, stop reason and aggregate token counters. Do not log headers, raw response bodies, request IDs or thinking text. This documentation update performs no network generation calls itself.

### Native model configuration

The four exact Claude IDs at the official ModelHelm base now receive locally generated `provider.npm: "@ai-sdk/anthropic"`, default `options.thinking: {type: "adaptive", display: "summarized"}`, and five variants whose payload is `{effort: LEVEL, thinking: {type: "adaptive", display: "summarized"}}`. None/minimal are explicitly disabled. No Claude entry is placed in the OpenAI `reasoningEffort` map. ModelHelm's provider ID, complete routing model IDs and scoped local proxy base remain stable.

V2 rendering translates the locally configured per-model SDK through a built-in adapter allowlist to `package: "@opencode/ai/providers/anthropic"`; it keeps GPT models on the provider's OpenAI-compatible adapter. Unknown package names cannot become imports. Remote directory parsing accepts only the supported capability fields and never copies arbitrary provider/npm/API/options fields. Native selection comes from the local exact-ID/official-URL allowlist shared with the proxy.

Both validated-cache and legacy/no-cache startup paths fill missing native fields without rewriting explicit local variants or nested provider/options overrides. Repeated startup is idempotent. Custom gateway URLs and alternate model IDs are not automatically routed to the native SDK.

An explicit local per-model SDK different from Anthropic remains authoritative. Such a model gets neither inferred native thinking nor native effort variants; if it has no variants, disabled entries prevent engine inference. Explicit user variants remain unchanged. Remote `variants[id].effort` is normalized into the compatible discovery vocabulary (`reasoningEffort`); only the known-Claude native materializer converts it to Claude `effort` and locally defined thinking settings.

The pinned V2 SDK can express effort changes inside messages, with its native beta headers, rather than always at top level. It can also add `thinking.block_binding`. Both forms are preserved. The successful valid/invalid gateway comparison above supports keeping this native behavior; `supportsEffortUpdates` is not disabled or guessed by the renderer.

### Executed native integration and regression checks

The pinned V1 1.18.30 and V2 2.0.26 fixtures successfully exercised the real model materializer, engine SDK and authenticated scoped proxy against a synthetic localhost upstream. All four Claude IDs were present with native SDK selection and exactly five efforts. Claude Opus 5.5 was selected for `high`, `xhigh` and `max` transport checks; high performed an actual single-file native `read` tool round trip, retaining the synthetic thinking text, signature, tool-use identity and tool result on continuation. V1 sent top-level output effort; V2's valid per-message effort format was accepted by the fixture. Existing compatible/GPT-6.1 reasoning regressions were retained. No external model request, real API key or real reasoning text was used in these fixtures.

The shared fixture is `gateway-reasoning-native-upstream.ts`. It rewrites the otherwise fixed official gateway destination only inside the isolated test process, refuses non-loopback network calls, uses synthetic credentials, and cleans up native processes/listeners and temporary HOME/XDG state. Run the same two native fixture commands documented above; the optional V1 GPT-6.1 selector still applies. These are transport, tool-integration and replay assertions against a fake model, not a real model-quality benchmark or a proof of every live tool chain.

After the explicit-SDK and remote-effort boundary repairs, the six-file gateway regression passed **62 tests / 495 assertions**. It includes validated-cache and no-cache startup, repeated-start idempotence, complete local metadata preservation, conflicting compatible/custom SDKs, model-level V2 rendering and remote SDK injection rejection. The actual public V2 adapter → runtime model options test passed **1 test / 21 assertions**, including both GPT and native Claude five-level controls. `pnpm --dir apps/server typecheck`, `pnpm --dir apps/app typecheck` and `git diff --check` passed. Native proxy/stream/cancellation tests are verified separately by their owning task; these counts do not include them.

## Initial live gateway check limitation

Three authorized minimal synthetic requests were attempted against the configured ModelHelm gateway. Their response content and credentials were not retained:

| Model | Optional effort field | Max output tokens | HTTP result |
| --- | --- | --- | --- |
| `deepseek/deepseek-v4-flash` | `reasoning_effort: low` | 128 | 503, `system_error` |
| `openai/gpt-5.5` | `reasoning_effort: low` | 64 | 503; error type not separately recorded |
| `deepseek/deepseek-v4-flash` | Omitted, same synthetic prompt as the first request | 128 | 503, `system_error` |

The no-effort control also failed in this initial batch, so generation and control acceptance were not established by those calls and the batch was stopped. The later authenticated GPT-6.1 follow-up above supersedes that limitation for the specific tested GPT-6.1 route and efforts; it does not establish the availability or behavior of the other models in this initial batch.
