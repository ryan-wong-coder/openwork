import { z } from "zod";
import { registerCloudSkillDiscovery, type CloudSkillContext } from "./openwork-cloud-skills-v2.js";
import { server as browserTools } from "./openwork-chrome-devtools.js";
import { createGatewayImageTools, GATEWAY_IMAGE_INSTRUCTION } from "./gateway-image-tools.js";
import { createZenoPersonalTools } from './zeno-personal-tools.js';
import { uiBridgeRequest } from './openwork-ui-bridge.js';
import { isStandaloneAgentProfile } from './local-client-profile.js';

const browserResult = z.object({
  content: z.array(z.union([z.object({ type: z.literal("text"), text: z.string() }),
    z.object({ type: z.literal("file"), uri: z.string(), mime: z.string() })])),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

type Tool = {
  name: string;
  description: string;
  input: Record<string, unknown>;
  options: { codemode: boolean };
  execute(input: unknown, context: { signal: AbortSignal; sessionID: string }): Promise<z.infer<typeof browserResult>>;
};
type Context = CloudSkillContext & {
  options: { url: string; token: string; clientProfile?: "local-gateway" | "connected"; browser?: { url: string; token: string }; image?: { url: string; token: string } };
  tool: { transform(callback: (editor: { add(tool: Tool): void }) => void): Promise<{ dispose(): Promise<void> }> };
};

// Separate credentials authorize app reads, conversation-scoped browser
// operations and image generation. None grants arbitrary host APIs.
export default {
  id: "openwork.context",
  async setup(context: Context) {
    const standalone = isStandaloneAgentProfile(context.options.clientProfile ?? process.env.OPENWORK_CLIENT_PROFILE);
    const browser = context.options.browser;
    const image = context.options.image;
    const imageDefinitions = image ? createGatewayImageTools(async (input, call: { signal: AbortSignal; sessionID: string }) => {
      const response = await fetch(image.url, {
        method: "POST", redirect: "error", signal: call.signal,
        headers: { Authorization: `Bearer ${image.token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ name: "openwork_image_generate", input, sessionId: call.sessionID }),
      });
      const payload: unknown = await response.json();
      if (!response.ok) {
        const message = payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string"
          ? payload.error : `图片生成未完成（${response.status}），请重试。`;
        throw new Error(message);
      }
      return payload;
    }) : undefined;
    const browserDefinitions = browser ? await browserTools() : undefined;
    const personalDefinition = standalone ? createZenoPersonalTools((input, call) => uiBridgeRequest('/personal', {
      method: 'POST', body: { input, sessionId: call.sessionID }, signal: call.signal, timeoutMs: 60_000,
    })).zeno_personal : undefined;
    const registration = await context.tool.transform(editor => {
      if (personalDefinition) editor.add({ name: 'zeno_personal', description: personalDefinition.description,
        input: z.toJSONSchema(z.object(personalDefinition.args).strict()), options: { codemode: false },
        async execute(input, call) { return { content: [{ type: 'text', text: await personalDefinition.execute(input, call) }] }; },
      });
      for (const name of ["openwork_context", "openwork_query"]) {
        editor.add({
          name,
          description: name === "openwork_context"
            ? "Read OpenWork app context and available read-only affordances. Use this to discover session.search and session.read for other conversations."
            : "Read an OpenWork affordance without changing the app or navigating. Use the exact id and arguments from openwork_context; session.read includes live background-agent activity.",
          input: name === "openwork_context" ? { type: "object", properties: {}, additionalProperties: false } : {
            type: "object", properties: { id: { type: "string" }, args: { type: "object", additionalProperties: true } },
            required: ["id"], additionalProperties: false,
          },
          options: { codemode: false },
          async execute(input, call) {
            const response = await fetch(context.options.url, {
              method: "POST", redirect: "error", signal: call.signal,
              headers: { Authorization: `Bearer ${context.options.token}`, "Content-Type": "application/json" },
              body: JSON.stringify({ name, input }),
            });
            if (!response.ok) throw new Error(`OpenWork read failed (${response.status})`);
            return { content: [{ type: "text", text: await response.text() }] };
          },
        });
      }
      if (browser && browserDefinitions) for (const [name, definition] of Object.entries(browserDefinitions.tool)) {
        editor.add({
          name, description: definition.description,
          input: z.toJSONSchema(z.object(definition.args)),
          options: { codemode: false },
          async execute(input, call) {
            const response = await fetch(browser.url, {
              method: "POST", redirect: "error", signal: call.signal,
              headers: { Authorization: `Bearer ${browser.token}`, "Content-Type": "application/json" },
              body: JSON.stringify({ name, input, sessionId: call.sessionID }),
            });
            if (!response.ok) throw new Error(`Browser request failed (${response.status})`);
            return browserResult.parse(await response.json());
          },
        });
      }
      if (imageDefinitions) {
        const definition = imageDefinitions.openwork_image_generate;
        editor.add({
          name: "openwork_image_generate",
          description: `${definition.description}\n${GATEWAY_IMAGE_INSTRUCTION}`,
          input: z.toJSONSchema(z.object(definition.args).strict()),
          options: { codemode: false },
          async execute(input, call) {
            return { content: [{ type: "text", text: await definition.execute(input, call) }] };
          },
        });
      }
    });
    const stopSkills = standalone ? async () => {} : await registerCloudSkillDiscovery(context);
    return async () => { await stopSkills(); await registration.dispose(); };
  },
};
