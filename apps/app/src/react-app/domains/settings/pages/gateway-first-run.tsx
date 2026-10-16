/** @jsxImportSource react */
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { OpenworkServerError, type GatewayConfig, type OpenworkServerClient } from "@/app/lib/openwork-server";
import { ZenoMark } from "@/components/brand/zeno-brand";
import { SecretField, type SecretFieldHandle } from "@/components/secret-field";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { SettingsNotice } from "../settings-section";

type SetupScreen = "input" | "managed" | "waiting" | "unavailable" | "ready";

function requiresManagement(error: unknown): boolean {
  return error instanceof OpenworkServerError && (error.status === 401 || error.status === 403);
}

function gatewayIsReady(config: GatewayConfig): boolean {
  return config.configured && config.ready === true && config.refresh !== "deferred";
}

export function GatewayFirstRun(props: {
  client: OpenworkServerClient;
  onComplete: (modelId: string) => Promise<void>;
  onSkip: () => void;
  onOpenSettings: () => void;
}) {
  const id = useId();
  const secret = useRef<SecretFieldHandle>(null);
  const inFlight = useRef(false);
  const completed = useRef(false);
  const active = useRef(false);
  const generation = useRef(0);
  const currentClient = useRef(props.client);
  currentClient.current = props.client;
  const onComplete = useRef(props.onComplete);
  onComplete.current = props.onComplete;
  const [screen, setScreen] = useState<SetupScreen>("input");
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState<"check" | "save" | null>(null);
  const [hasKey, setHasKey] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = loading || action !== null;

  const isCurrent = useCallback((version: number, client: OpenworkServerClient) => (
    active.current && generation.current === version && currentClient.current === client
  ), []);

  const apply = useCallback(async (config: GatewayConfig, version: number, client: OpenworkServerClient, complete: (modelId: string) => Promise<void>) => {
    if (!isCurrent(version, client)) return;
    if (!config.configured) {
      setScreen("input");
      setNotice(null);
      return;
    }
    setScreen("waiting");
    if (!gatewayIsReady(config)) {
      setNotice("密钥已保存，等待引擎应用。");
      return;
    }
    setNotice(null);
    try {
      await complete(config.chatModel);
      if (!isCurrent(version, client)) return;
      completed.current = true;
      setScreen("ready");
      setNotice("已就绪");
    } catch {
      if (!isCurrent(version, client)) return;
      setNotice("密钥已保存");
      setError("连接状态尚未刷新，请重新检查。");
    }
  }, [isCurrent]);

  const check = useCallback(async () => {
    const version = generation.current;
    const client = props.client;
    const complete = onComplete.current;
    if (!isCurrent(version, client) || inFlight.current || completed.current) return;
    inFlight.current = true;
    setAction("check");
    setError(null);
    try {
      await apply(await client.getGatewayConfig(), version, client, complete);
    } catch (cause) {
      if (!isCurrent(version, client)) return;
      setNotice(null);
      setScreen(requiresManagement(cause) ? "managed" : "unavailable");
      if (!requiresManagement(cause)) setError("暂时无法读取网关配置，请检查服务连接后重试。");
    } finally {
      if (isCurrent(version, client)) {
        inFlight.current = false;
        setAction(null);
        setLoading(false);
      }
    }
  }, [apply, isCurrent, props.client]);

  useEffect(() => {
    active.current = true;
    generation.current += 1;
    inFlight.current = false;
    completed.current = false;
    secret.current?.clear();
    setHasKey(false);
    setScreen("input");
    setLoading(true);
    setError(null);
    setNotice(null);
    void check();
    return () => { active.current = false; generation.current += 1; };
  }, [check]);

  const save = async () => {
    const version = generation.current;
    const client = props.client;
    const complete = onComplete.current;
    if (!isCurrent(version, client) || inFlight.current || completed.current || loading || screen !== "input") return;
    const apiKey = secret.current?.take().trim() ?? "";
    if (!apiKey) {
      setError("请输入 API 密钥。");
      secret.current?.focus();
      return;
    }
    inFlight.current = true;
    setAction("save");
    setError(null);
    setNotice(null);
    try {
      // Preserve the deployment's address, models and generation parameters.
      const config = await client.updateGatewayConfig({ apiKey });
      if (!isCurrent(version, client)) return;
      if (!config.configured) {
        setError("密钥未保存，请检查后重试。");
        return;
      }
      await apply(config, version, client, complete);
    } catch (cause) {
      if (!isCurrent(version, client)) return;
      if (requiresManagement(cause) && !(cause instanceof OpenworkServerError && cause.code === "gateway_request_failed")) setScreen("managed");
      else setError("连接未完成，请检查密钥与服务连接后重试。");
      // Never render upstream errors: they may contain a submitted credential.
    } finally {
      if (isCurrent(version, client)) {
        inFlight.current = false;
        setAction(null);
      }
    }
  };

  return (
    <div className="flex min-h-full w-full flex-1 items-center justify-center overflow-y-auto bg-dls-canvas px-6 py-10 text-foreground" data-testid="gateway-first-run">
      <section className="mx-auto flex w-full max-w-sm flex-col gap-6" aria-labelledby={`${id}-title`} aria-busy={busy}>
        <div className="flex items-center gap-3">
          <ZenoMark className="size-8" />
          <h1 id={`${id}-title`} className="text-xl font-semibold tracking-tight">连接 ModelHelm</h1>
        </div>
        {loading ? <div className="flex flex-col gap-3" aria-label="正在检查网关"><Skeleton className="h-4 w-20" /><Skeleton className="h-10 w-full" /></div> : <>
          {screen === "input" ? <SecretField id={`${id}-key`} label="API 密钥" placeholder="粘贴 ModelHelm API 密钥" handleRef={secret} onValueChange={setHasKey} onSubmit={() => void save()} disabled={busy} autoFocus testId="gateway-first-run-key" /> : null}
          {screen === "managed" ? <SettingsNotice>网关由部署者管理，请联系部署者完成配置。</SettingsNotice> : null}
          {notice ? <div role="status"><SettingsNotice>{notice}</SettingsNotice></div> : null}
          {error ? <div role="alert"><SettingsNotice tone="error">{error}</SettingsNotice></div> : null}
        </>}
        <div className="flex flex-col gap-2">
          {screen === "input" || loading ? <Button disabled={busy || !hasKey} onClick={() => void save()}>{action === "save" ? <RefreshCw className="animate-spin motion-reduce:animate-none" /> : null}保存并开始</Button> : screen !== "ready" ? <Button disabled={busy} onClick={() => void check()}><RefreshCw className={action === "check" ? "animate-spin motion-reduce:animate-none" : undefined} />重新检查</Button> : null}
          <Button variant="ghost" disabled={busy} onClick={() => { secret.current?.clear(); props.onSkip(); }}>稍后设置</Button>
          <Button variant="link" size="sm" className="self-center text-muted-foreground" disabled={busy} onClick={() => { secret.current?.clear(); props.onOpenSettings(); }}>网关设置</Button>
        </div>
      </section>
    </div>
  );
}
