import { expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createManagedOpencodeV2Server } from "../src/managed-opencode-v2";
import { createV2ContextBridge } from "../src/opencode-v2-context-bridge";
import { OpenWorkExtensionsPreview } from "../src/opencode-plugins/openwork-extensions-preview";
import contextPlugin from "../src/opencode-plugins/openwork-context-v2";
import { createUiControlServer } from "../../desktop/electron/ui-control-server.mjs";
import { createZenoPersonalToolsService } from "../../desktop/electron/zeno-personal-tools.mjs";

// A disposable child exercises the real managed spawn environment, generated
// plugin options and native tool implementation. It is an engine API harness,
// not a model or a substitute claim of a full native OpenCode acceptance run.
const engineHarness = `#!${process.execPath}
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
const config=JSON.parse(await readFile(join(process.env.OPENCODE_CONFIG_DIR,'opencode.json'),'utf8'));
const entry=config.plugins.find(item=>item.options?.url);
const plugin=await import(new URL('server.js',entry.package+'/').href);
const tools=new Map();
const dispose=await plugin.default.setup({options:entry.options,
 tool:{async transform(register){register({add(tool){tools.set(tool.name,tool)}});return{async dispose(){}}}},
 skill:{async transform(){return{async dispose(){}}},async reload(){}}});
const server=createServer(async(req,res)=>{
 if(req.headers.authorization!=='Basic '+Buffer.from('opencode:'+process.env.OPENCODE_PASSWORD).toString('base64')){res.writeHead(401).end();return}
 try{
  let output;
  if(req.url==='/api/info')output={version:'synthetic-engine-harness',pid:process.pid};
  else if(req.url==='/probe/environment')output={discovery:process.env.OPENWORK_UI_CONTROL_DISCOVERY,privateKeyPresent:process.env.SYNTHETIC_PRIVATE_KEY!==undefined,registered:tools.has('zeno_personal'),profile:entry.options.clientProfile};
  else if(req.url==='/probe/interactive'||req.url==='/probe/scheduled'){
   let raw='';for await(const chunk of req)raw+=chunk;
   const tool=tools.get('zeno_personal');if(!tool)throw Error('Native personal tool was not registered');
   output=await tool.execute(JSON.parse(raw),{sessionID:req.url.endsWith('/scheduled')?'ses_scheduled':'ses_interactive',signal:new AbortController().signal});
  }else{res.writeHead(404).end();return}
  res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify(output));
 }catch{res.writeHead(400,{'content-type':'application/json'}).end(JSON.stringify({error:'Rejected synthetic call'}))}
});
server.listen(0,'127.0.0.1',()=>console.log('server listening on http://127.0.0.1:'+server.address().port));
process.on('SIGTERM',async()=>{await dispose();server.close(()=>process.exit(0))});
`;

// This disposable executable uses a POSIX shebang; the registry/read-boundary
// test below also runs on Windows without launching an executable fixture.
test.skipIf(process.platform === "win32")("V1 and managed V2 execute the same personal boundary through the selected desktop discovery", async () => {
  const root = await mkdtemp(join(tmpdir(), "zeno-personal-engine-wiring-"));
  const previousProfile = process.env.OPENWORK_CLIENT_PROFILE;
  const previousDiscovery = process.env.OPENWORK_UI_CONTROL_DISCOVERY;
  let identity: { userId: string; deviceId: string; generation: number } | null = null;
  let fitnessEnabled = true;
  let writes = 0;
  const sessions: string[] = [];
  const personal = createZenoPersonalToolsService({
    service: {
      identity: async () => identity,
      getSession: async () => identity ? { user: { id: identity.userId } } : null,
      accountDirectory: () => join(root, "account"),
      sync: async () => ({ records: [], cursor: 0, hasMore: false }),
      internalRequest: async (method: string, path: string) => {
        if (method === "GET" && path === "/features") return { status: 200, body: {
          zenoAccounts: true, personalCalendar: true, fitnessTracking: fitnessEnabled, localScheduledTasks: true,
        } };
        writes++;
        throw new Error("This fixture permits no business writes");
      },
    },
    isWindowOpen: () => true,
    executionModeForSession: (id: string) => id === "ses_scheduled" ? "scheduled" : "interactive",
  });
  const ui = createUiControlServer({
    app: { getPath: () => root }, appName: "Synthetic", appIdentifier: "synthetic.zeno",
    getWindow: () => { throw new Error("No desktop window in this integration test"); },
    personalTask: (call: { input: unknown; sessionId: string }) => { sessions.push(call.sessionId); return personal.execute(call); },
  });
  let bridge: Awaited<ReturnType<typeof createV2ContextBridge>> | undefined;
  let managed: Awaited<ReturnType<typeof createManagedOpencodeV2Server>> | undefined;
  let v1: Awaited<ReturnType<typeof OpenWorkExtensionsPreview>> | undefined;
  try {
    await ui.start();
    // The trusted generated options, rather than an unrelated process value,
    // select the profile. The explicit discovery must survive the V2 whitelist.
    process.env.OPENWORK_CLIENT_PROFILE = "connected";
    v1 = await OpenWorkExtensionsPreview(undefined, { clientProfile: "local-gateway" });
    const system = ["Synthetic system"];
    await v1["experimental.chat.system.transform"]({}, { system });
    expect(system.join("\n")).toContain("catalogue");
    expect(JSON.parse(await v1.tool.openwork_query.execute({ id: "personal.catalogue" }))).toMatchObject({ ok: false, code: "unavailable" });
    expect(JSON.parse(await v1.tool.openwork_execute.execute({ id: "personal.write" }, {}))).toMatchObject({ ok: false, code: "unavailable" });
    bridge = await createV2ContextBridge(async () => ({ context: { availableAffordances: [] } }), { clientProfile: "local-gateway" });
    const bin = join(root, "engine-harness.mjs");
    await writeFile(bin, engineHarness, { mode: 0o700 });
    for (const folder of ["home", "config", "cache", "data", "state"]) await mkdir(join(root, folder));
    managed = await createManagedOpencodeV2Server({
      bin, rootDir: join(root, "engine"), contextTools: bridge, bootTimeoutMs: 10_000,
      env: {
        HOME: join(root, "home"), XDG_CONFIG_HOME: join(root, "config"), XDG_CACHE_HOME: join(root, "cache"),
        XDG_DATA_HOME: join(root, "data"), XDG_STATE_HOME: join(root, "state"),
        OPENWORK_CLIENT_PROFILE: "connected", OPENWORK_UI_CONTROL_DISCOVERY: join(root, "openwork-ui-control.json"),
        SYNTHETIC_PRIVATE_KEY: "fixture-not-for-child", OPENCODE_DISABLE_MODELS_FETCH: "1",
      },
    });
    const environment = await managed.fetchJson("/probe/environment");
    expect(environment.json).toEqual({ discovery: join(root, "openwork-ui-control.json"), privateKeyPresent: false, registered: true, profile: "local-gateway" });
    const activeV1 = v1;
    const activeV2 = managed;
    const v2Call = async (input: unknown, scheduled = false) => {
      const result = await activeV2.fetchJson(scheduled ? "/probe/scheduled" : "/probe/interactive", { method: "POST", body: input });
      expect(result.status).toBe(200);
      const envelope = result.json;
      if (!envelope || typeof envelope !== "object" || !("content" in envelope) || !Array.isArray(envelope.content)) throw new Error("Missing native tool result");
      return JSON.parse(envelope.content[0].text);
    };
    const callers = [
      (input: unknown, scheduled = false) => activeV1.tool.zeno_personal.execute(input, { sessionID: scheduled ? "ses_scheduled" : "ses_interactive" }).then(JSON.parse),
      v2Call,
    ];
    for (const call of callers) {
      identity = null;
      expect(await call({ action: "read", kind: "routine" })).toMatchObject({ ok: false, code: "account_required" });
      identity = { userId: "synthetic-user", deviceId: "synthetic-device", generation: 1 };
      expect(await call({ action: "read", kind: "routine" })).toMatchObject({ ok: true, records: [] });
      fitnessEnabled = false;
      expect(await call({ action: "catalogue", id: "0025" })).toMatchObject({ ok: false, code: "feature_disabled" });
      fitnessEnabled = true;
      const catalogue = await call({ action: "catalogue", id: "0025" });
      expect(catalogue.ok).toBe(true);
      expect(catalogue.exercises).toHaveLength(1);
      expect(catalogue.exercises[0].exerciseId).toBe("0025");
      expect(await call({ action: "write", kind: "routine", operationId: "synthetic-blocked-write", data: {} }, true)).toMatchObject({ ok: false, code: "proposal_required" });
    }
    expect(writes).toBe(0);
    expect(new Set(sessions)).toEqual(new Set(["ses_interactive", "ses_scheduled"]));
  } finally {
    await managed?.close();
    await bridge?.close();
    await v1?.dispose();
    await ui.stop();
    if (previousProfile === undefined) delete process.env.OPENWORK_CLIENT_PROFILE; else process.env.OPENWORK_CLIENT_PROFILE = previousProfile;
    if (previousDiscovery === undefined) delete process.env.OPENWORK_UI_CONTROL_DISCOVERY; else process.env.OPENWORK_UI_CONTROL_DISCOVERY = previousDiscovery;
    await rm(root, { recursive: true, force: true });
  }
}, 20_000);

test("V2 discovers the registered native personal executor without granting commands to its read credential", async () => {
  const previousProfile = process.env.OPENWORK_CLIENT_PROFILE;
  process.env.OPENWORK_CLIENT_PROFILE = "local-gateway";
  const fixtureAffordances = [
    { id: "personal.catalogue", kind: "query", executor: { kind: "tool", tool: "zeno_personal" } },
    { id: "personal.write", kind: "command", executor: { kind: "tool", tool: "zeno_personal" } },
    { id: "unregistered.tool", kind: "query", executor: { kind: "tool", tool: "missing_tool" } },
    { id: "ui.command", kind: "command", executor: { kind: "openwork" } },
  ];
  const bridges: Array<Awaited<ReturnType<typeof createV2ContextBridge>>> = [];
  try {
    for (const profile of ["local-gateway", "connected"]) {
      if (profile !== "local-gateway" && profile !== "connected") throw new Error("Invalid fixture profile");
      const bridge = await createV2ContextBridge(async path => {
        if (path === "/experimental/ui-control/request") return { context: { availableAffordances: fixtureAffordances } };
        if (path === "/experimental/connect/skills") return { skills: [] };
        throw new Error("Unexpected host read");
      }, { clientProfile: profile });
      bridges.push(bridge);
      const names: string[] = [];
      const dispose = await contextPlugin.setup({ options: bridge,
        tool: { async transform(register) { register({ add(tool) { names.push(tool.name); } }); return { async dispose() {} }; } },
        skill: { async transform() { return { async dispose() {} }; }, async reload() {} },
      });
      try {
        expect(names.includes("zeno_personal")).toBe(profile === "local-gateway");
        const post = (name: string, input: unknown = {}) => fetch(bridge.url, { method: "POST", headers: { Authorization: `Bearer ${bridge.token}`, "Content-Type": "application/json" }, body: JSON.stringify({ name, input }) });
        const response = await post("openwork_context");
        expect(response.status).toBe(200);
        const result = await response.json();
        const ids = result.context.availableAffordances.map((entry: { id: string }) => entry.id);
        expect(ids.includes("personal.catalogue")).toBe(profile === "local-gateway");
        expect(ids.includes("personal.write")).toBe(profile === "local-gateway");
        expect(ids).not.toContain("unregistered.tool");
        expect(ids).not.toContain("ui.command");
        expect(await (await post("openwork_query", { id: "personal.write" })).json()).toMatchObject({ ok: false, code: "unavailable" });
        expect((await post("zeno_personal", { action: "write" })).status).toBe(400);
        expect((await post("openwork_execute", { id: "personal.write" })).status).toBe(400);
      } finally { await dispose(); }
    }
  } finally {
    await Promise.all(bridges.map(bridge => bridge.close()));
    if (previousProfile === undefined) delete process.env.OPENWORK_CLIENT_PROFILE; else process.env.OPENWORK_CLIENT_PROFILE = previousProfile;
  }
});
