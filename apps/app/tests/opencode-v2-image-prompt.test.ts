import { describe, expect, test } from "bun:test";
import { createClientV2, v2PromptText } from "../src/app/lib/opencode-v2-adapter";
import { attachmentNoteText } from "../src/app/lib/v2-prompt-context";

type PromptParts = NonNullable<Parameters<ReturnType<typeof createClientV2>["session"]["promptAsync"]>[0]["parts"]>;
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aS8QAAAAASUVORK5CYII=";
const GIF = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
const model = { providerID: "modelhelm", modelID: "fixture-vision" };

function fixture() {
  const prompts: Array<{ sessionID: string; body: unknown }> = [];
  const writes: Array<{ path: string; body: unknown }> = [];
  let failModel = false;
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    const path = new URL(request.url).pathname;
    if (request.method === "GET") {
      if (/^\/api\/session\/[^/]+$/.test(path)) return Response.json({ data: { agent: "openwork" } });
      if (path === "/api/agent") return Response.json({ data: [{ id: "build", name: "Build", mode: "primary", hidden: false }] });
      if (path === "/api/skill") return Response.json({ data: [{ id: "fixture-skill", name: "Fixture skill" }] });
    }
    if (request.method === "POST" || request.method === "PUT") {
      const body: unknown = await request.json();
      writes.push({ path, body });
      const prompt = /^\/api\/session\/([^/]+)\/prompt$/.exec(path);
      if (prompt?.[1]) {
        prompts.push({ sessionID: decodeURIComponent(prompt[1]), body });
        return Response.json({ data: {} });
      }
      if (path.endsWith("/permission")) return Response.json({ data: { effect: "allow" } });
      if (path.endsWith("/model") && failModel) return Response.json({ message: "Fixture model unavailable" }, { status: 400 });
      if (path.endsWith("/model") || path.endsWith("/agent") || path.endsWith("/instructions/entries/openwork-context")) return Response.json({ data: {} });
    }
    return Response.json({ message: `Unexpected fixture route: ${request.method} ${path}` }, { status: 404 });
  } });
  return {
    client: createClientV2(`http://127.0.0.1:${server.port}`, undefined, {}), prompts, writes,
    failModel: () => { failModel = true; },
    stop: () => server.stop(true),
  };
}

describe("V2 initial image prompt transport", () => {
  test("sends inline and workspace images in order while retaining mixed text and attachment markers", async () => {
    const fileURI = "file:///fixture/workspace/chat-attachments/%E6%88%AA%E5%9B%BE%20two.jpg";
    const note = attachmentNoteText([
      { filename: "截图 one.png", workspacePath: "chat-attachments/one.png", url: "file:///fixture/one.png" },
      { filename: "motion.gif", workspacePath: "chat-attachments/motion.gif", url: "file:///fixture/motion.gif" },
      { filename: "截图 two.jpg", workspacePath: "chat-attachments/two.jpg", url: fileURI },
      { filename: "document.pdf", workspacePath: "chat-attachments/document.pdf", url: "file:///fixture/document.pdf" },
    ]);
    const parts: PromptParts = [
      { type: "text", text: note, synthetic: true },
      { type: "text", text: "比较 " },
      { type: "file", filename: "截图 one.png", mime: "image/png", url: PNG },
      { type: "text", text: " 与 " },
      { type: "file", filename: "motion.gif", mime: "image/gif", url: GIF },
      { type: "text", text: "，再看 " },
      { type: "file", filename: "截图 two.jpg", mime: "image/jpeg", url: fileURI },
      { type: "file", filename: "document.pdf", mime: "application/pdf", url: "file:///fixture/document.pdf" },
      { type: "text", text: "。" },
    ];
    const app = fixture();
    try {
      const result = await app.client.session.promptAsync({ sessionID: "ses_existing", model, parts });
      expect(result.response.ok).toBe(true);
      expect(app.prompts).toEqual([{ sessionID: "ses_existing", body: {
        text: v2PromptText(parts),
        files: [{ uri: PNG, name: "截图 one.png" }, { uri: GIF, name: "motion.gif" }, { uri: fileURI, name: "截图 two.jpg" }],
      } }]);
      expect(v2PromptText(parts)).toContain("比较 <attachment>截图 one.png</attachment> 与 <attachment>motion.gif</attachment>，再看 <attachment>截图 two.jpg</attachment><attachment>document.pdf</attachment>。");
      expect(v2PromptText(parts)).toContain(note);
      expect(app.writes).toContainEqual({ path: "/api/session/ses_existing/agent", body: { agent: "build" } });
    } finally { await app.stop(); }
  });

  test("image-only and unnamed images reach initial prompts in separate sessions, with skills and system instructions preserved", async () => {
    const app = fixture();
    try {
      const first = await app.client.session.promptAsync({ sessionID: "ses_new", model, parts: [{ type: "file", mime: "image/png", url: PNG }] });
      expect(first.response.ok).toBe(true);
      const parts: PromptParts = [
        { type: "text", text: "Inspect this" },
        { type: "file", mime: "image/gif", url: GIF, filename: "animation.gif" },
        { type: "text", text: "Load the selected skill", synthetic: true, metadata: { openworkSelectedSkill: { id: "fixture-skill", name: "Fixture skill" } } },
      ];
      const second = await app.client.session.promptAsync({ sessionID: "ses_fork", model, parts, system: "Retain system context", variant: "high" });
      expect(second.response.ok).toBe(true);
      expect(app.prompts).toEqual([
        { sessionID: "ses_new", body: { text: "", files: [{ uri: PNG }] } },
        { sessionID: "ses_fork", body: { text: v2PromptText(parts), files: [{ uri: GIF, name: "animation.gif" }], skills: [{ id: "fixture-skill" }] } },
      ]);
      expect(app.writes).toContainEqual({ path: "/api/experimental/session/ses_fork/instructions/entries/openwork-context", body: { value: "Retain system context" } });
      expect(app.writes).toContainEqual({ path: "/api/session/ses_fork/model", body: { model: { providerID: model.providerID, id: model.modelID, variant: "high" } } });
    } finally { await app.stop(); }
  });

  test("keeps non-image, unsupported MIME and remote attachments on their existing path-note behavior", async () => {
    const parts: PromptParts = [
      { type: "text", text: "Open these files" },
      { type: "file", mime: "application/pdf", url: "data:application/pdf;base64,JVBERg==", filename: "a.pdf" },
      { type: "file", mime: "application/octet-stream", url: "file:///fixture/archive.zip", filename: "archive.zip" },
      { type: "file", mime: "image/tiff", url: "file:///fixture/scan.tiff", filename: "scan.tiff" },
      { type: "file", mime: "image/png", url: "https://fixture.invalid/image.png", filename: "remote.png" },
      { type: "file", mime: "image/png", url: "data:text/plain;base64,cGxhaW4=", filename: "mismatch.png" },
      { type: "file", mime: "image/png", url: PNG.replace("data:", "DATA:"), filename: "unsupported-uri.png" },
      { type: "file", mime: "image/png", url: "not-a-uri", filename: "invalid.png" },
    ];
    const app = fixture();
    try {
      const result = await app.client.session.promptAsync({ sessionID: "ses_files", model, parts });
      expect(result.response.ok).toBe(true);
      expect(app.prompts).toEqual([{ sessionID: "ses_files", body: { text: v2PromptText(parts) } }]);
    } finally { await app.stop(); }
  });

  test("ordinary text has no files key and a failed model selection cannot submit images", async () => {
    const app = fixture();
    try {
      const plain = await app.client.session.promptAsync({ sessionID: "ses_plain", model, parts: [{ type: "text", text: "Plain text" }] });
      expect(plain.response.ok).toBe(true);
      expect(app.prompts).toEqual([{ sessionID: "ses_plain", body: { text: "Plain text" } }]);
      app.failModel();
      const failed = await app.client.session.promptAsync({ sessionID: "ses_blocked", model, parts: [{ type: "file", mime: "image/png", url: PNG }] });
      expect(failed.response.ok).toBe(false);
      expect(app.prompts).toHaveLength(1);
    } finally { await app.stop(); }
  });
});
