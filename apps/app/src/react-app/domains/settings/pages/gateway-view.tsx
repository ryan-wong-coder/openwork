/** @jsxImportSource react */
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { ChevronRight, RefreshCw } from "lucide-react";
import type { OpenworkServerClient } from "@/app/lib/openwork-server";
import { SecretField, type SecretFieldHandle } from "@/components/secret-field";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { LayoutStack } from "../settings-layout";
import { SettingsNotice } from "../settings-section";

type GatewayDraft = {
  baseURL: string;
  chatModel: string;
  imageModel: string;
  imageSize: string;
  imageQuality: string;
  requestTimeoutMs: number;
  imageGenerationEnabled: boolean;
};

type GatewayModelChoice = { id: string; name: string; kind: "chat" | "image" | "other" };

const DEFAULT_DRAFT: GatewayDraft = {
  baseURL: "https://api.modelhelm.com/v1",
  chatModel: "anthropic/claude-sonnet-5",
  imageModel: "openai/gpt-image-2",
  imageSize: "1024x1024",
  imageQuality: "auto",
  requestTimeoutMs: 180_000,
  imageGenerationEnabled: true,
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "操作未完成，请检查网关地址和密钥后重试。";
}

function GatewayModelField(props: {
  id: string;
  label: string;
  value: string;
  models: GatewayModelChoice[];
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const [custom, setCustom] = useState(false);
  const choices = props.models.some((model) => model.id === props.value)
    ? props.models
    : [{ id: props.value, name: props.value, kind: "other" }, ...props.models];
  return (
    <Field>
      <FieldLabel htmlFor={props.id}>{props.label}</FieldLabel>
      <Select
        value={custom ? "__custom__" : props.value}
        onValueChange={(value) => {
          if (value === "__custom__") setCustom(true);
          else if (value) { setCustom(false); props.onChange(value); }
        }}
        disabled={props.disabled}
      >
        <SelectTrigger id={props.id} className="w-full"><SelectValue>{custom ? "自定义模型" : choices.find((model) => model.id === props.value)?.name || props.value}</SelectValue></SelectTrigger>
        <SelectContent>
          {choices.filter((model) => model.id).map((model) => <SelectItem key={model.id} value={model.id}>{model.name || model.id}</SelectItem>)}
          <SelectItem value="__custom__">自定义模型…</SelectItem>
        </SelectContent>
      </Select>
      {custom ? <Input aria-label={`${props.label}标识`} value={props.value} disabled={props.disabled} onChange={(event) => props.onChange(event.currentTarget.value)} placeholder="输入网关返回的完整模型名称" /> : null}
    </Field>
  );
}

export function GatewayView(props: {
  client: OpenworkServerClient | null;
  busy?: boolean;
  onGatewayReady?: (modelId: string) => void | Promise<void>;
}) {
  const id = useId();
  const secret = useRef<SecretFieldHandle>(null);
  const readyCallback = useRef(props.onGatewayReady);
  readyCallback.current = props.onGatewayReady;
  const [draft, setDraft] = useState<GatewayDraft>(DEFAULT_DRAFT);
  const [loading, setLoading] = useState(true);
  const [configured, setConfigured] = useState(false);
  const [providerReady, setProviderReady] = useState(false);
  const [pendingApply, setPendingApply] = useState(false);
  const [keyLast4, setKeyLast4] = useState<string | null>(null);
  const [hasNewKey, setHasNewKey] = useState(false);
  const [models, setModels] = useState<GatewayModelChoice[]>([]);
  const [action, setAction] = useState<"save" | "sync" | "test" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const disabled = Boolean(props.busy || loading || action || !props.client);

  const load = useCallback(async () => {
    if (!props.client) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      const config = await props.client.getGatewayConfig();
      setDraft({
        baseURL: config.baseURL,
        chatModel: config.chatModel,
        imageModel: config.imageModel,
        imageSize: config.imageSize,
        imageQuality: config.imageQuality,
        requestTimeoutMs: config.requestTimeoutMs,
        imageGenerationEnabled: config.imageGenerationEnabled !== false,
      });
      setConfigured(config.configured);
      setProviderReady(config.configured && config.ready !== false);
      setPendingApply(config.refresh === "deferred");
      setKeyLast4(config.apiKeyLast4 ?? null);
      if (config.configured) {
        const catalog = await props.client.getGatewayModels();
        setModels(catalog.models);
        const deferred = config.refresh === "deferred" || catalog.refresh === "deferred";
        setPendingApply(deferred);
        if (deferred) setNotice("配置已保存，等待引擎应用。");
        const refreshed = await props.client.getGatewayConfig();
        setProviderReady(refreshed.configured && refreshed.ready !== false);
        setPendingApply(deferred || refreshed.refresh === "deferred");
        if (refreshed.refresh === "deferred") setNotice("配置已保存，等待引擎应用。");
      }
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setLoading(false); }
  }, [props.client]);

  useEffect(() => { void load(); }, [load]);

  const save = async () => {
    if (!props.client || disabled) return;
    setAction("save"); setError(null); setNotice(null);
    try {
      const apiKey = secret.current?.take().trim();
      const config = await props.client.updateGatewayConfig({ ...draft, ...(apiKey ? { apiKey } : {}) });
      setConfigured(config.configured);
      setProviderReady(config.configured && config.ready !== false);
      setKeyLast4(config.apiKeyLast4 ?? null);
      let deferred = config.refresh === "deferred";
      let modelCount: number | null = null;
      setPendingApply(deferred);
      setNotice(deferred ? "配置已保存，等待引擎应用。" : "网关配置已保存。");
      try {
        const catalog = await props.client.getGatewayModels();
        setModels(catalog.models);
        modelCount = catalog.models.length;
        deferred ||= catalog.refresh === "deferred";
      } catch (cause) { setError(`模型目录同步未完成：${errorMessage(cause)}`); }
      try { await readyCallback.current?.(config.chatModel); }
      catch { deferred = true; }
      setPendingApply(deferred);
      const synced = modelCount === null ? "" : `已同步 ${modelCount} 个模型。`;
      setNotice(deferred ? `配置已保存，等待引擎应用。${synced}` : `网关配置已保存。${synced}`);
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setAction(null); }
  };

  const sync = async () => {
    if (!props.client || disabled) return;
    setAction("sync"); setError(null); setNotice(null);
    try {
      const client = props.client;
      const catalog = secret.current
        ? await secret.current.preview((value) => client.getGatewayModels({ ...draft, ...(value.trim() ? { apiKey: value.trim() } : {}) }))
        : await client.getGatewayModels(draft);
      setModels(catalog.models);
      if (catalog.refresh) setPendingApply(catalog.refresh === "deferred");
      setDraft((previous) => ({
        ...previous,
        chatModel: catalog.models.some((model) => model.id === previous.chatModel && model.kind === "chat") ? previous.chatModel : catalog.models.find((model) => model.kind === "chat")?.id ?? previous.chatModel,
        imageModel: catalog.models.some((model) => model.id === previous.imageModel && model.kind === "image") ? previous.imageModel : catalog.models.find((model) => model.kind === "image")?.id ?? previous.imageModel,
      }));
      setNotice(`已同步 ${catalog.models.length} 个模型。${catalog.refresh === "deferred" ? "等待引擎应用。" : ""}`);
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setAction(null); }
  };

  const testConnection = async () => {
    if (!props.client || disabled) return;
    setAction("test"); setError(null); setNotice(null);
    try {
      const result = await props.client.testGateway();
      if (result.ok) setNotice(`连接正常 · ${result.model} · ${result.latencyMs} 毫秒`);
      else setError(result.message || "连接测试未通过，请检查密钥和模型名称后重试。");
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setAction(null); }
  };

  if (loading) return <LayoutStack><Skeleton className="h-9 w-40" /><Skeleton className="h-20 w-full" /><Skeleton className="h-20 w-full" /><Skeleton className="h-20 w-full" /></LayoutStack>;

  return (
    <LayoutStack>
      <section className="flex flex-col gap-5" data-testid="gateway-settings">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-base font-medium">模型网关</h2>
          <span className="text-xs text-muted-foreground">{configured ? `密钥已保存${keyLast4 ? ` · 末四位 ${keyLast4}` : ""}${pendingApply ? " · 等待引擎应用" : providerReady ? "" : " · 待同步模型"}` : "尚未配置密钥"}</span>
        </div>
        {!props.client ? <SettingsNotice>本地服务尚未连接，连接后即可保存网关配置。</SettingsNotice> : null}
        <Field><FieldLabel htmlFor={`${id}-url`}>网关地址</FieldLabel><Input id={`${id}-url`} type="url" value={draft.baseURL} disabled={disabled} onChange={(event) => setDraft((previous) => ({ ...previous, baseURL: event.currentTarget.value }))} placeholder={DEFAULT_DRAFT.baseURL} /></Field>
        <SecretField id={`${id}-key`} label="API 密钥" handleRef={secret} onValueChange={setHasNewKey} disabled={disabled} placeholder={configured ? "留空以保留已保存的密钥" : "粘贴网关 API 密钥"} onSubmit={() => void save()} testId="gateway-api-key" />
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" disabled={disabled || (!configured && !hasNewKey)} onClick={() => void sync()}><RefreshCw className={action === "sync" ? "animate-spin" : undefined} />{action === "sync" ? "正在同步模型…" : "同步模型目录"}</Button>
          <Button variant="outline" disabled={disabled || !configured} onClick={() => void testConnection()}>{action === "test" ? "正在测试连接…" : "测试已保存连接"}</Button>
          {models.length ? <span className="text-xs text-muted-foreground">{models.filter((model) => model.kind === "chat").length} 个对话模型 · {models.filter((model) => model.kind === "image").length} 个图片模型</span> : null}
        </div>
        <div className="grid gap-4 border-t border-border pt-5 sm:grid-cols-2">
          <GatewayModelField id={`${id}-chat`} label="默认对话模型" value={draft.chatModel} models={models.filter((model) => model.kind === "chat")} disabled={disabled} onChange={(chatModel) => setDraft((previous) => ({ ...previous, chatModel }))} />
          <GatewayModelField id={`${id}-image`} label="图片生成模型" value={draft.imageModel} models={models.filter((model) => model.kind === "image")} disabled={disabled} onChange={(imageModel) => setDraft((previous) => ({ ...previous, imageModel }))} />
        </div>
        <div className="flex min-h-11 items-center justify-between gap-3 border-t border-border py-2"><label htmlFor={`${id}-images`} className="text-sm font-medium">允许在对话中生成图片</label><Switch id={`${id}-images`} checked={draft.imageGenerationEnabled} disabled={disabled} onCheckedChange={(imageGenerationEnabled) => setDraft((previous) => ({ ...previous, imageGenerationEnabled }))} /></div>
        <details className="group/gateway border-t border-border pt-2">
          <summary className="flex w-fit cursor-pointer list-none items-center gap-2 py-2 text-sm font-medium"><ChevronRight className="size-4 transition-transform group-open/gateway:rotate-90" />生成参数与超时</summary>
          <div className="grid gap-4 py-3 sm:grid-cols-2">
            <Field><FieldLabel htmlFor={`${id}-size`}>请求图片尺寸</FieldLabel><Input id={`${id}-size`} value={draft.imageSize} disabled={disabled} onChange={(event) => setDraft((previous) => ({ ...previous, imageSize: event.currentTarget.value }))} placeholder="auto 或 1024x1024" /><p className="text-xs text-muted-foreground">实际尺寸以网关返回为准。</p></Field>
            <Field><FieldLabel htmlFor={`${id}-quality`}>图片质量</FieldLabel><Select value={draft.imageQuality} disabled={disabled} onValueChange={(value) => {
              if (value === "auto" || value === "low" || value === "medium" || value === "high") setDraft((previous) => ({ ...previous, imageQuality: value }));
            }}><SelectTrigger id={`${id}-quality`} className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="auto">自动</SelectItem><SelectItem value="low">低</SelectItem><SelectItem value="medium">中</SelectItem><SelectItem value="high">高</SelectItem></SelectContent></Select></Field>
            <Field><FieldLabel htmlFor={`${id}-timeout`}>请求超时（秒）</FieldLabel><Input id={`${id}-timeout`} type="number" min={10} max={600} value={draft.requestTimeoutMs / 1000} disabled={disabled} onChange={(event) => {
              const seconds = event.currentTarget.valueAsNumber;
              if (Number.isFinite(seconds)) setDraft((previous) => ({ ...previous, requestTimeoutMs: Math.round(seconds * 1000) }));
            }} /></Field>
          </div>
        </details>
        {error ? <SettingsNotice tone="error">{error}</SettingsNotice> : null}
        {notice ? <SettingsNotice>{notice}</SettingsNotice> : null}
        <div className="flex justify-end"><Button disabled={disabled || (!configured && !hasNewKey) || !draft.baseURL.trim() || !draft.chatModel.trim() || !draft.imageModel.trim()} onClick={() => void save()}>{action === "save" ? "正在保存并同步…" : "保存并同步模型"}</Button></div>
      </section>
    </LayoutStack>
  );
}
