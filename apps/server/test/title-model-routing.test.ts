import { describe, expect, test } from "bun:test";
import { createTitleModelRouting } from "../src/title-model-routing";

describe("independent engine small-model routing", () => {
  test("a stale global model cannot take a ModelHelm conversation to another provider", async () => {
    const routing = createTitleModelRouting("local-gateway");
    const config = { small_model: "legacy-provider/retired-model" };
    await routing.config(config);
    expect(config).not.toHaveProperty("small_model");
    const output: { model?: unknown } = {};
    await routing["experimental.provider.small_model"]({ provider: {
      id: "modelhelm", models: { "vendor/chat-model": { id: "vendor/chat-model", providerID: "modelhelm" } },
    } }, output);
    expect(output).toEqual({}); // Native fallback stays with this conversation's provider/model.
  });

  test("retains an available same-provider preference including its complete routed model ID", async () => {
    const routing = createTitleModelRouting("local-gateway");
    await routing.config({ small_model: "modelhelm/vendor/small-model" });
    const model = { id: "vendor/small-model", providerID: "modelhelm", options: { custom: true } };
    const output: { model?: unknown } = {};
    await routing["experimental.provider.small_model"]({ provider: {
      id: "modelhelm", models: { "vendor/small-model": model },
    } }, output);
    expect(output.model).toBe(model);
  });

  test("a filtered, removed or unavailable preferred model falls back to the current provider", async () => {
    const routing = createTitleModelRouting("local-gateway");
    await routing.config({ small_model: "modelhelm/vendor/removed" });
    const output: { model?: unknown } = {};
    await routing["experimental.provider.small_model"]({ provider: { id: "modelhelm", models: {} } }, output);
    expect(output).toEqual({});
  });

  test("does not inject ModelHelm when no gateway is configured; other self-hosted providers keep their own preference", async () => {
    const routing = createTitleModelRouting("local-gateway");
    await routing.config({ small_model: "self-hosted/local-small" });
    const model = { id: "local-small", providerID: "self-hosted" };
    const output: { model?: unknown } = {};
    await routing["experimental.provider.small_model"]({ provider: { id: "self-hosted", models: { "local-small": model } } }, output);
    expect(output.model).toBe(model);
    const other: { model?: unknown } = {};
    await routing["experimental.provider.small_model"]({ provider: { id: "another-local", models: { "chat": {} } } }, other);
    expect(other).toEqual({});
  });

  test("preserves explicit title agent selection and all unrelated merged config", async () => {
    const routing = createTitleModelRouting("local-gateway");
    const title = { model: "self-hosted/explicit-title", temperature: 0.3 };
    const config = { small_model: "legacy-provider/retired-model", agent: { title }, model: "modelhelm/vendor/chat" };
    await routing.config(config);
    expect(config.agent.title).toBe(title);
    expect(config.agent.title.model).toBe("self-hosted/explicit-title");
    expect(config.model).toBe("modelhelm/vendor/chat");
  });

  for (const profile of ["connected", undefined]) {
    test(`leaves legacy connected behavior unchanged: ${profile ?? "unspecified"}`, async () => {
      const routing = createTitleModelRouting(profile);
      const config = { small_model: "other-provider/small" };
      await routing.config(config);
      expect(config.small_model).toBe("other-provider/small");
      const output: { model?: unknown } = {};
      await routing["experimental.provider.small_model"]({ provider: { id: "other-provider", models: { small: {} } } }, output);
      expect(output).toEqual({});
    });
  }

  test("does not resolve prototype properties as model IDs", async () => {
    const routing = createTitleModelRouting("local-gateway");
    await routing.config({ small_model: "self-hosted/toString" });
    const output: { model?: unknown } = {};
    await routing["experimental.provider.small_model"]({ provider: { id: "self-hosted", models: {} } }, output);
    expect(output).toEqual({});
  });
});
