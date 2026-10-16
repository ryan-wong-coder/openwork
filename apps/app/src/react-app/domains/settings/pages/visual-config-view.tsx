import { useEffect, useId, useRef, useState } from "react";
import { ChevronRight, Plus, RotateCcw, Save, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { OpenworkServerClient } from "@/app/lib/openwork-server";
import { LayoutSection, LayoutSectionHeader, LayoutSectionTitle } from "../settings-layout";
import { SettingsNotice } from "../settings-section";
import {
  configValueKind, configValuesEqual, initialConfigValue, isConfigObject, parseConfigDocument,
  updateConfigValue, writeConfigDocument, type ConfigObject, type ConfigPath, type ConfigValue, type ConfigValueKind,
} from "../state/visual-config-document";
import {
  completeWorkspaceConfig, configFieldForKey, configFieldInitial, customConfigField, opencodeConfigSchema, openworkConfigSchema,
  validateConfigFields, workspaceEditableConfig, type ConfigField,
} from "../state/visual-config-schema";

type ConfigScope = "project" | "global" | "workspace";
const scopes: { value: ConfigScope; label: string }[] = [
  { value: "project", label: "当前工作区的引擎配置" },
  { value: "global", label: "此设备的引擎配置" },
  { value: "workspace", label: "当前工作区的选项" },
];
const kinds: { value: ConfigValueKind; label: string }[] = [
  { value: "string", label: "文本" }, { value: "number", label: "数字" }, { value: "boolean", label: "开关" },
  { value: "object", label: "选项组" }, { value: "array", label: "列表" }, { value: "null", label: "未指定" },
];
function isScope(value: unknown): value is ConfigScope {
  return value === "project" || value === "global" || value === "workspace";
}
function isKind(value: unknown): value is ConfigValueKind {
  return kinds.some((kind) => kind.value === value);
}

type ConfigNodeProps = {
  value: ConfigValue;
  schema: ConfigField;
  path: ConfigPath;
  disabled: boolean;
  onChange: (path: ConfigPath, value: ConfigValue | undefined) => void;
  onInvalid: (path: ConfigPath, error: string | null) => void;
  removable?: boolean;
  query?: string;
};

function ConfigKindPicker({ value, schema, disabled, onChange }: {
  value: ConfigValue; schema: ConfigField; disabled: boolean; onChange: (value: ConfigValue) => void;
}) {
  const kind = configValueKind(value);
  const options = kinds.filter((option) => schema.kinds.includes(option.value) || option.value === kind);
  if (options.length < 2) return null;
  return <Select value={kind} items={options} disabled={disabled} onValueChange={(next) => {
    if (isKind(next)) onChange(next === schema.kinds[0] ? configFieldInitial(schema) : initialConfigValue(next));
  }}>
    <SelectTrigger size="sm" aria-label={`${schema.label}的值类型`}><SelectValue /></SelectTrigger>
    <SelectContent>{options.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
  </Select>;
}

function NumberConfigInput({ value, schema, disabled, onChange, onInvalid, id }: {
  value: number; schema: ConfigField; disabled: boolean; id: string;
  onChange: (value: number) => void; onInvalid: (error: string | null) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  const [invalid, setInvalid] = useState(false);
  useEffect(() => { setDraft(String(value)); setInvalid(false); onInvalid(null); }, [value]);
  useEffect(() => () => onInvalid(null), []);
  return <Input id={id} type="number" inputMode={schema.integer ? "numeric" : "decimal"} value={draft}
    min={schema.minimum} max={schema.maximum} step={schema.integer ? 1 : "any"}
    disabled={disabled} className="w-full sm:w-60" aria-invalid={invalid} aria-label={schema.label}
    onChange={(event) => {
      const text = event.target.value;
      setDraft(text);
      const number = Number(text);
      const error = !text.trim() || !Number.isFinite(number) ? `${schema.label}必须是有效数字。` : null;
      setInvalid(Boolean(error)); onInvalid(error);
      if (!error) onChange(number);
    }} />;
}

function ConfigLeaf(props: ConfigNodeProps) {
  const id = useId();
  const { value, schema, path, onChange, onInvalid } = props;
  const change = (next: ConfigValue) => onChange(path, next);
  const invalid = (error: string | null) => onInvalid(path, error);
  let input;
  if (typeof value === "boolean") {
    input = <Switch id={id} aria-label={schema.label} checked={value} disabled={props.disabled} onCheckedChange={change} />;
  } else if (typeof value === "number") {
    input = <NumberConfigInput id={id} schema={schema} value={value} disabled={props.disabled} onChange={change} onInvalid={invalid} />;
  } else if (typeof value === "string" && schema.choices) {
    const options = schema.choices.some((option) => option.value === value) ? schema.choices : [...schema.choices, { value, label: value || "未选择" }];
    input = <Select value={value} items={options} disabled={props.disabled} onValueChange={(next) => { if (typeof next === "string") change(next); }}>
      <SelectTrigger id={id} className="w-full sm:w-60" aria-label={schema.label}><SelectValue /></SelectTrigger>
      <SelectContent>{options.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
    </Select>;
  } else if (typeof value === "string") {
    const secret = schema.secret || path.some((part) => typeof part === "string" && /(?:api[_-]?key|password|secret|token|authorization|credential)/i.test(part));
    input = schema.multiline && !secret
      ? <Textarea id={id} aria-label={schema.label} value={value} disabled={props.disabled} rows={4} className="min-w-0 flex-1" onChange={(event) => change(event.target.value)} />
      : <Input id={id} aria-label={schema.label} value={value} disabled={props.disabled} type={secret ? "password" : "text"}
        autoComplete="off" spellCheck={false} className="min-w-0 w-full sm:w-60" onChange={(event) => change(event.target.value)} />;
  } else input = schema.kinds.length > 1 ? null : <span id={id} className="text-sm text-muted-foreground">未指定</span>;
  return <div className="flex min-h-11 flex-wrap items-center justify-between gap-3 py-2">
    <label htmlFor={id} className="min-w-0 flex-1 text-sm">{schema.label}</label>
    <div className={`flex min-w-0 flex-wrap items-center justify-end gap-2 ${schema.multiline ? "w-full" : "max-w-full"}`}>
      <ConfigKindPicker value={value} schema={schema} disabled={props.disabled} onChange={change} />
      {input}
      {props.removable ? <RemoveConfigButton label={schema.label} disabled={props.disabled} onClick={() => onChange(path, undefined)} /> : null}
    </div>
  </div>;
}

function RemoveConfigButton({ label, disabled, onClick }: { label: string; disabled: boolean; onClick: () => void }) {
  return <Button type="button" size="icon-sm" variant="ghost" aria-label={`移除${label}`} disabled={disabled} onClick={(event) => { event.preventDefault(); event.stopPropagation(); onClick(); }}><Trash2 className="size-4" /></Button>;
}

function AddCustomOption(props: {
  value: ConfigObject; schema: ConfigField; disabled: boolean;
  onAdd: (key: string, value: ConfigValue) => void;
}) {
  const [key, setKey] = useState("");
  const [kind, setKind] = useState<ConfigValueKind>(props.schema.additional?.kinds[0] ?? "string");
  const [error, setError] = useState<string | null>(null);
  const schema = props.schema.additional ?? customConfigField;
  const availableKinds = kinds.filter((option) => schema.kinds.includes(option.value));
  return <details className="group/custom pt-2">
    <summary className="flex w-fit cursor-pointer list-none items-center gap-2 py-2 text-sm text-muted-foreground"><ChevronRight className="size-4 transition-transform group-open/custom:rotate-90" />添加自定义选项</summary>
    <div className="flex flex-wrap items-center gap-2 py-2">
      <Input aria-label="自定义选项名称" placeholder="选项名称" value={key} disabled={props.disabled} className="w-full sm:w-52" onChange={(event) => { setKey(event.target.value); setError(null); }} />
      <Select value={kind} items={availableKinds} disabled={props.disabled} onValueChange={(next) => { if (isKind(next)) setKind(next); }}>
        <SelectTrigger size="sm" aria-label="自定义选项类型"><SelectValue /></SelectTrigger>
        <SelectContent>{availableKinds.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
      </Select>
      <Button type="button" size="sm" variant="outline" disabled={props.disabled || !key.trim()} onClick={() => {
        const name = key.trim();
        if (["__proto__", "constructor", "prototype"].includes(name)) { setError("此选项名称不可用。"); return; }
        if (Object.hasOwn(props.value, name)) { setError("此选项已存在，请修改现有选项。"); return; }
        props.onAdd(name, kind === schema.kinds[0] ? configFieldInitial(schema) : initialConfigValue(kind));
        setKey(""); setError(null);
      }}><Plus className="size-4" />添加选项</Button>
      {error ? <p role="alert" className="w-full text-sm text-destructive">{error}</p> : null}
    </div>
  </details>;
}

function matchesQuery(key: string, field: ConfigField, query: string): boolean {
  return `${key} ${field.label}`.toLocaleLowerCase().includes(query)
    || Object.entries(field.properties ?? {}).some(([child, schema]) => matchesQuery(child, schema, query))
    || Boolean(field.additional && matchesQuery("", field.additional, query));
}

function ConfigChildren(props: ConfigNodeProps) {
  const { value, schema, path } = props;
  if (Array.isArray(value)) return <div className="divide-y divide-border">
    {value.map((item, index) => <ConfigNode key={index} {...props} value={item} schema={{ ...(schema.items ?? customConfigField), label: `第 ${index + 1} 项` }} path={[...path, index]} removable />)}
    {!value.length ? <p className="py-3 text-sm text-muted-foreground">暂无项目</p> : null}
    <div className="py-2"><Button type="button" variant="outline" size="sm" disabled={props.disabled} onClick={() => props.onChange(path, [...value, configFieldInitial(schema.items ?? customConfigField)])}><Plus className="size-4" />添加项目</Button></div>
  </div>;
  if (!isConfigObject(value)) return null;
  const keys = [...new Set([...Object.keys(schema.properties ?? {}), ...Object.keys(value)])];
  const query = props.query?.trim().toLocaleLowerCase() ?? "";
  const visible = keys.filter((key) => !query || matchesQuery(key, configFieldForKey(schema, key), query)
    || (Object.hasOwn(value, key) && JSON.stringify(value[key]).toLocaleLowerCase().includes(query)));
  return <div className="divide-y divide-border">
    {visible.map((key) => {
      const child = configFieldForKey(schema, key);
      return Object.hasOwn(value, key)
        ? <ConfigNode key={key} {...props} schema={child} value={value[key]} path={[...path, key]} query={undefined} removable />
        : <div key={key} className="flex min-h-11 items-center justify-between gap-3 py-2">
          <span className="text-sm">{child.label}</span>
          <Button type="button" variant="ghost" size="sm" disabled={props.disabled} aria-label={`设置${child.label}`} onClick={() => props.onChange([...path, key], configFieldInitial(child))}><Plus className="size-4" />设置</Button>
        </div>;
    })}
    {!visible.length ? <p className="py-3 text-sm text-muted-foreground">没有匹配的选项</p> : null}
    <AddCustomOption value={value} schema={schema} disabled={props.disabled} onAdd={(key, next) => props.onChange([...path, key], next)} />
  </div>;
}

function ConfigNode(props: ConfigNodeProps) {
  const { value, schema, path } = props;
  if (!Array.isArray(value) && !isConfigObject(value)) return <ConfigLeaf {...props} />;
  return <details className="group/config min-w-0">
    <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 py-2 text-sm font-medium">
      <ChevronRight className="size-4 shrink-0 transition-transform group-open/config:rotate-90" /><span className="min-w-0 flex-1">{schema.label}</span>
      {props.removable ? <RemoveConfigButton label={schema.label} disabled={props.disabled} onClick={() => props.onChange(path, undefined)} /> : null}
    </summary>
    {schema.kinds.length > 1 ? <div className="flex items-center justify-end gap-2 pb-2">
      <ConfigKindPicker value={value} schema={schema} disabled={props.disabled} onChange={(next) => props.onChange(path, next)} />
    </div> : null}
    <div className="min-w-0 pl-4"><ConfigChildren {...props} /></div>
  </details>;
}

type LoadedDocument = { scope: ConfigScope; content: string; expectedContent: string | null; original: ConfigObject; editable: ConfigObject; path: string | null };
export type VisualConfigViewProps = {
  client: OpenworkServerClient | null;
  workspaceId: string | null;
  busy?: boolean;
  onSaved?: () => void | Promise<void>;
};

export function VisualConfigView(props: VisualConfigViewProps) {
  const [scope, setScope] = useState<ConfigScope>("project");
  const [loaded, setLoaded] = useState<LoadedDocument | null>(null);
  const [draft, setDraft] = useState<ConfigObject>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [query, setQuery] = useState("");
  const [invalidInputs, setInvalidInputs] = useState<Record<string, string>>({});
  const [formVersion, setFormVersion] = useState(0);
  const request = useRef(0);
  const schema = scope === "workspace" ? openworkConfigSchema : opencodeConfigSchema;
  const dirty = Boolean(loaded && !configValuesEqual(loaded.editable, draft));
  const available = Boolean(props.client && props.workspaceId);
  const disabled = !available || loading || saving || Boolean(props.busy);
  const validation = validateConfigFields(draft, schema);

  const load = async () => {
    const client = props.client;
    const workspaceId = props.workspaceId;
    const currentRequest = ++request.current;
    setError(null); setSaved(false); setLoaded(null); setInvalidInputs({});
    if (!client || !workspaceId) { setLoading(false); return; }
    setLoading(true);
    try {
      let document: LoadedDocument;
      if (scope === "workspace") {
        const result = await client.getConfig(workspaceId);
        if (!isConfigObject(result.openwork)) throw new Error("工作区选项无法读取，请重新加载。");
        document = { scope, content: "", expectedContent: null, original: result.openwork, editable: workspaceEditableConfig(result.openwork), path: null };
      } else {
        const result = await client.readOpencodeConfigFile(workspaceId, scope);
        const original = parseConfigDocument(result.content ?? "");
        document = { scope, content: result.content ?? "", expectedContent: result.exists ? result.content ?? "" : null, original, editable: original, path: result.path ?? null };
      }
      if (request.current !== currentRequest) return;
      setLoaded(document); setDraft(document.editable);
    } catch (cause) {
      if (request.current === currentRequest) setError(cause instanceof Error ? cause.message : "配置无法读取，请重试。");
    } finally { if (request.current === currentRequest) setLoading(false); }
  };
  useEffect(() => { void load(); return () => { request.current += 1; }; }, [props.client, props.workspaceId, scope]);

  const save = async () => {
    if (!props.client || !props.workspaceId || !loaded || disabled || validation.length || Object.keys(invalidInputs).length) return;
    setSaving(true); setError(null); setSaved(false);
    try {
      if (scope === "workspace") {
        const next = completeWorkspaceConfig(loaded.original, draft);
        await props.client.patchConfig(props.workspaceId, { openwork: next, openworkReplace: true, expectedOpenwork: loaded.original });
        setLoaded({ ...loaded, original: next, editable: draft });
      } else {
        const content = writeConfigDocument(loaded.content, loaded.original, draft);
        const result = await props.client.writeOpencodeConfigFile(props.workspaceId, scope, content, loaded.expectedContent);
        if (!result.ok) throw new Error(result.stderr || "配置未保存，请重试。");
        setLoaded({ ...loaded, original: draft, editable: draft, content, expectedContent: content });
      }
      setSaved(true);
      if (props.onSaved) {
        try { await props.onSaved(); }
        catch { setError("配置已保存，运行中的服务尚未应用修改。请在任务结束后重新加载工作区。"); }
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "配置未保存，请重试。"); }
    finally { setSaving(false); }
  };

  return <LayoutSection id="visual-configuration">
    <LayoutSectionHeader><LayoutSectionTitle>配置选项</LayoutSectionTitle></LayoutSectionHeader>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <Select value={scope} items={scopes} disabled={disabled || dirty || Object.keys(invalidInputs).length > 0} onValueChange={(value) => { if (isScope(value)) { setScope(value); setQuery(""); } }}>
        <SelectTrigger aria-label="配置范围" className="max-w-full"><SelectValue /></SelectTrigger>
        <SelectContent>{scopes.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent>
      </Select>
      <div className="flex items-center gap-2">
        <Button type="button" variant="ghost" size="sm" disabled={!loaded || disabled} onClick={() => { setDraft(loaded?.editable ?? {}); setError(null); setSaved(false); setInvalidInputs({}); setFormVersion((version) => version + 1); }}><RotateCcw className="size-4" />撤销修改</Button>
        <Button type="button" size="sm" disabled={disabled || !dirty || validation.length > 0 || Object.keys(invalidInputs).length > 0} aria-busy={saving} onClick={() => void save()}><Save className="size-4" />保存修改</Button>
      </div>
    </div>
    {!available ? <SettingsNotice>本地服务尚未连接。连接后可修改配置。</SettingsNotice> : null}
    {error ? <SettingsNotice tone="error"><div role="alert" className="flex flex-wrap items-center justify-between gap-3"><span>{error}</span><Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => void load()}>重新加载</Button></div></SettingsNotice> : null}
    {Object.values(invalidInputs).map((message) => <p key={message} role="alert" className="text-sm text-destructive">{message}</p>)}
    {dirty && validation.length ? <SettingsNotice tone="error"><ul className="list-inside list-disc">{validation.map((message) => <li key={message}>{message}</li>)}</ul></SettingsNotice> : null}
    {saved ? <p role="status" className="text-sm text-muted-foreground">修改已保存</p> : null}
    {dirty ? <p role="status" className="text-sm text-muted-foreground">有未保存的修改</p> : null}
    {loading ? <div role="status" aria-label="正在读取配置" className="space-y-3">{[0, 1, 2, 3].map((index) => <div key={index} className="h-11 animate-pulse rounded-md bg-muted" />)}</div> : loaded ? <>
      <Input aria-label="搜索配置选项" placeholder="搜索配置选项" value={query} onChange={(event) => setQuery(event.target.value)} />
      <ConfigChildren key={formVersion} value={draft} schema={schema} path={[]} query={query} disabled={disabled}
        onChange={(path, value) => { setDraft((current) => updateConfigValue(current, path, value)); setSaved(false); }}
        onInvalid={(path, message) => setInvalidInputs((current) => {
          const key = JSON.stringify(path);
          if (current[key] === message || (!message && !Object.hasOwn(current, key))) return current;
          const next = { ...current };
          if (message) next[key] = message;
          else delete next[key];
          return next;
        })} />
      {loaded.path ? <details className="group/source"><summary className="flex w-fit cursor-pointer list-none items-center gap-2 py-2 text-sm text-muted-foreground"><ChevronRight className="size-4 transition-transform group-open/source:rotate-90" />配置位置</summary><p className="break-all py-2 font-mono text-xs text-muted-foreground">{loaded.path}</p></details> : null}
    </> : null}
  </LayoutSection>;
}
