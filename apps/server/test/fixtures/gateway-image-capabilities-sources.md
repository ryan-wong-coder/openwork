# Gateway image-input capability sources

Reviewed on 2026-10-17 (Asia/Shanghai). All model pages below were actually opened;
the relevant modality sections were read. This is a primary-documentation check,
not a claim that every ModelHelm upstream route has been exercised with an image.
No model request or credential access was used for this table.

The fallback applies only to the exact base `https://api.modelhelm.com/v1` and the
full routing IDs listed below. An explicit catalog image declaration takes
precedence. Another gateway, a new alias, or a similarly named sibling remains
unknown until its own capability declaration or evidence exists. The table enables
only image input, not native PDFs, video, audio, image output, or image generation.

## OpenAI

Every linked model page's **Modalities** section lists image input. Each row maps
one full gateway routing ID to that exact vendor model; no family-prefix rule is
used.

| Exact ModelHelm routing ID | Official OpenAI documentation |
| --- | --- |
| `openai/gpt-5.4` | [GPT-5.4](https://developers.openai.com/api/docs/models/gpt-5.4) |
| `openai/gpt-5.4-mini` | [GPT-5.4 Mini](https://developers.openai.com/api/docs/models/gpt-5.4-mini) |
| `openai/gpt-5.5` | [GPT-5.5](https://developers.openai.com/api/docs/models/gpt-5.5) |
| `openai/gpt-5.6-luna` | [GPT-5.6 Luna](https://developers.openai.com/api/docs/models/gpt-5.6-luna) |
| `openai/gpt-5.6-sol` | [GPT-5.6 Sol](https://developers.openai.com/api/docs/models/gpt-5.6-sol) |
| `openai/gpt-5.6-terra` | [GPT-5.6 Terra](https://developers.openai.com/api/docs/models/gpt-5.6-terra) |
| `openai/gpt-6-astra` | [GPT-6 Astra](https://developers.openai.com/api/docs/models/gpt-6-astra) |
| `openai/gpt-6-luna` | [GPT-6 Luna](https://developers.openai.com/api/docs/models/gpt-6-luna) |
| `openai/gpt-6-sol` | [GPT-6 Sol](https://developers.openai.com/api/docs/models/gpt-6-sol) |
| `openai/gpt-6.1-sol` | [GPT-6.1 Sol](https://developers.openai.com/api/docs/models/gpt-6.1-sol) |

[Images and vision](https://developers.openai.com/api/docs/guides/images-vision)
documents the Chat Completions `image_url` content part and Base64 data URI form.
Model modality support and a gateway's actual protocol implementation are separate
facts; the fallback itself proves neither tool compatibility nor upstream health.

## Anthropic

The **Capabilities → Input → output** section of each exact model page lists
text and images as input and text as output. The dotted ModelHelm Opus 5.5 routing
ID is retained; the native vendor ID uses `claude-opus-5-5`.

| Exact ModelHelm routing ID | Primary source |
| --- | --- |
| `anthropic/claude-fable-5` | [Claude Fable 5](https://platform.claude.com/docs/en/models/fable-5/overview) |
| `anthropic/claude-opus-5` | [Claude Opus 5](https://platform.claude.com/docs/en/models/opus-5/overview) |
| `anthropic/claude-opus-5.5` | [Claude Opus 5.5](https://platform.claude.com/docs/en/models/opus-5-5/overview) |
| `anthropic/claude-sonnet-5` | [Claude Sonnet 5](https://platform.claude.com/docs/en/models/sonnet-5/overview) |

[Claude vision](https://platform.claude.com/docs/en/build-with-claude/vision)
documents native `image` content blocks with Base64, URL, and file sources. The
client's existing trusted native Claude adapter handles the protocol choice;
catalog metadata must not supply SDK packages or endpoints.

## Google

Both exact model pages list image in **Supported data types → Inputs**. Their
other input types are intentionally outside this image-only fallback.

| Exact ModelHelm routing ID | Primary source |
| --- | --- |
| `google/gemini-3.7-flash` | [Gemini 3.7 Flash](https://ai.google.dev/gemini-api/docs/models/gemini-3.7-flash) |
| `google/gemini-3.8-flash` | [Gemini 3.8 Flash](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash) |

## Qwen

Alibaba's [visual model catalog](https://www.alibabacloud.com/help/en/model-studio/vision-model/)
explicitly lists these exact models with image inputs or maximum image counts:
`qwen/qwen3.6-35b-a3b`, `qwen/qwen3.6-flash`, `qwen/qwen3.6-plus`,
`qwen/qwen3.7-plus`, `qwen/qwen3.8-flash`, and `qwen/qwen3.8-max`.
The individual [Qwen3.6-27B model page](https://www.alibabacloud.com/help/en/model-studio/qwen3-6-27b)
and [Qwen3.6-35B-A3B page](https://www.alibabacloud.com/help/en/model-studio/qwen3-6-35b-a3b)
also explicitly list image input, supporting `qwen/qwen3.6-27b` and confirming the
35B route independently.

**Deliberate exclusion:** `qwen/qwen3.7-max` receives no fallback. Its
[exact vendor model page](https://www.alibabacloud.com/help/en/model-studio/qwen3-7-max)
states that the bare alias corresponds to the May 20 text-only snapshot; the
June 8 snapshot adds image and video input. This difference must not be erased
with a `qwen3.7` name rule. This change does not add an unlisted dated alias.

## Z.ai

Each exact model page explicitly lists image in **Input Modality**. GLM-5, 5.2,
5.3, and 5.3-Flash receive no capability merely because a sibling is visual.

| Exact ModelHelm routing ID | Primary source |
| --- | --- |
| `z-ai/glm-4.5v` | [GLM-4.5V](https://docs.z.ai/guides/vlm/glm-4.5v) |
| `z-ai/glm-4.6v` | [GLM-4.6V](https://docs.z.ai/guides/vlm/glm-4.6v) |
| `z-ai/glm-5v-turbo` | [GLM-5V-Turbo](https://docs.z.ai/guides/vlm/glm-5v-turbo) |

## xAI

The **At a glance → Modalities** section of both exact model pages lists text and
image input with text output.

| Exact ModelHelm routing ID | Primary source |
| --- | --- |
| `x-ai/grok-4.5` | [Grok 4.5](https://docs.x.ai/developers/models/grok-4.5) |
| `x-ai/grok-4.6` | [Grok 4.6](https://docs.x.ai/developers/models/grok-4.6) |

## Moonshot AI

The official [Kimi vision guide](https://platform.kimi.ai/docs/guide/use-kimi-vision-model)
explicitly names `kimi-k2.7-code` and `kimi-k3`, and demonstrates image input with
Chat Completions content parts. It supports the exact gateway routes
`moonshotai/kimi-k2.7-code` and `moonshotai/kimi-k3`.
The publisher's [Kimi K2.7 Code model card](https://huggingface.co/moonshotai/Kimi-K2.7-Code)
independently documents **Chat Completion with visual content** using images.

## MiniMax

The official [MiniMax-M3 self-hosting guide](https://platform.minimax.io/docs/guides/local-deploy-m3)
explicitly lists native image input as supported and provides an OpenAI-compatible
image request. The [vendor model catalog](https://platform.minimax.io/docs/guides/models-intro)
identifies MiniMax-M3 as the multimodal model, and the
[Chat Completions reference](https://platform.minimax.io/docs/api-reference/text-chat-openai)
lists its native model ID. These support the exact `minimax/minimax-m3` gateway
route. No M2/M2.1/M2.5/M2.7 capability is inferred from shared billing plans,
the separate image-understanding MCP tool, or the newer M3 model.

## Metadata interpretation and test scope

Accepted declaration paths are the canonical `image` boolean, `vision` boolean,
`capabilities.vision` boolean, `modalities.input`, `capabilities.input`,
`input_modalities`, and `architecture.input_modalities`. Input lists use explicit
modality tokens; the capabilities input object requires an `image` boolean.
An explicit complete input list without `image` means false, including an empty
list. An object without an image key remains unknown. Invalid types and unknown
modality tokens remain unknown. Conflicting valid declarations retain false.

The parser returns only `{image?: boolean}`. `attachment`, model names,
architecture summary strings, output modalities, SDK packages, URLs, options,
credentials, tools, and reasoning declarations cannot imply image support or be
copied into runtime configuration through this parser. Unit tests verify this
normalization, explicit negatives, cache serialization, endpoint scoping, exact
IDs, and unknown siblings entirely offline. Native-engine transport and live
gateway-image results require their own evidence.
