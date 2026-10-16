"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, Plus, Trash2, Undo2, Upload } from "lucide-react";
import { DenButton } from "../../_components/ui/button";
import { DenInput } from "../../_components/ui/input";
import { DenSelect } from "../../_components/ui/select";
import { DenSecretInput } from "../../_components/ui/secret-input";
import { DenSwitch } from "../../_components/ui/switch";
import {
  isStructuredObject, readStructuredProvider, readStructuredValue, structuredInitial, structuredKind, structuredLabels, structuredSuggestions,
  updateStructuredAtPath, type StructuredKind, type StructuredObject, type StructuredPath, type StructuredValue,
} from "./structured-config-value";

const kinds: { value: StructuredKind; label: string }[] = [
  { value: "string", label: "文本" }, { value: "number", label: "数字" }, { value: "boolean", label: "开关" },
  { value: "object", label: "选项组" }, { value: "array", label: "列表" }, { value: "null", label: "未指定" },
];
const isKind = (value: string): value is StructuredKind => kinds.some((kind) => kind.value === value);

function AddOption({ value, disabled, suggestions, onAdd }: { value: StructuredObject; disabled: boolean; suggestions: boolean; onAdd: (key: string, value: StructuredValue) => void }) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<StructuredKind>("string");
  const [error, setError] = useState<string | null>(null);
  return <details className="group/add py-2">
    <summary className="flex w-fit cursor-pointer list-none items-center gap-2 py-2 text-sm text-muted-foreground"><ChevronRight className="size-4 transition-transform group-open/add:rotate-90" />添加选项</summary>
    <div className="flex flex-wrap items-center gap-2 py-2">
      {suggestions ? <div className="min-w-48 flex-1"><DenSelect value="" aria-label="选择常用选项" disabled={disabled} onChange={(event) => {
        const option = structuredSuggestions.find((item) => item.value === event.target.value);
        if (option) { setName(option.value); setKind(option.kind); setError(null); }
      }}><option value="">选择常用选项</option>{structuredSuggestions.filter((option) => !Object.hasOwn(value, option.value)).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</DenSelect></div> : null}
      <div className="min-w-40 flex-1"><DenInput aria-label="选项名称" value={name} placeholder="选项名称" disabled={disabled} onChange={(event) => { setName(event.target.value); setError(null); }} /></div>
      <div className="w-28"><DenSelect value={kind} aria-label="新选项类型" disabled={disabled} onChange={(event) => { if (isKind(event.target.value)) setKind(event.target.value); }}>
        {kinds.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
      </DenSelect></div>
      <DenButton type="button" variant="secondary" size="sm" disabled={disabled || !name.trim()} onClick={() => {
        const key = name.trim();
        if (["__proto__", "constructor", "prototype"].includes(key)) { setError("此选项名称不可用。"); return; }
        if (Object.hasOwn(value, key)) { setError("此选项已存在，请修改现有选项。"); return; }
        onAdd(key, structuredInitial(kind)); setName(""); setError(null);
      }}><Plus className="size-4" />添加</DenButton>
      {error ? <p role="alert" className="w-full text-sm text-destructive">{error}</p> : null}
    </div>
  </details>;
}

type NodeProps = {
  value: StructuredValue;
  path: StructuredPath;
  label: string;
  disabled: boolean;
  change: (path: StructuredPath, value: StructuredValue | undefined) => void;
  invalid: (path: StructuredPath, message: string | null) => void;
  suggestions: boolean;
  editRoot?: boolean;
  fieldLabels: Record<string, string>;
};

function NumberField({ value, label, disabled, onChange, onInvalid }: {
  value: number; label: string; disabled: boolean; onChange: (value: number) => void; onInvalid: (message: string | null) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  const [error, setError] = useState(false);
  useEffect(() => { setDraft(String(value)); setError(false); onInvalid(null); }, [value]);
  useEffect(() => () => onInvalid(null), []);
  return <DenInput type="number" step="any" value={draft} aria-label={label} aria-invalid={error} disabled={disabled} onChange={(event) => {
    const text = event.target.value;
    setDraft(text);
    const next = Number(text);
    const invalid = !text.trim() || !Number.isFinite(next);
    setError(invalid); onInvalid(invalid ? `${label}必须是有效数字。` : null);
    if (!invalid) onChange(next);
  }} />;
}

function StructuredNode(props: NodeProps) {
  const { value, path, label, disabled, change, invalid } = props;
  const kind = structuredKind(value);
  const remove = path.length ? <DenButton type="button" variant="ghost" size="xs" aria-label={`移除${label}`} disabled={disabled} onClick={(event) => {
    event.preventDefault(); event.stopPropagation(); change(path, undefined);
  }}><Trash2 className="size-4" /></DenButton> : null;
  const typePicker = <div className="w-28 shrink-0"><DenSelect aria-label={`${label}的值类型`} value={kind} disabled={disabled} onChange={(event) => {
    if (isKind(event.target.value)) change(path, structuredInitial(event.target.value));
  }}>{kinds.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</DenSelect></div>;
  if (Array.isArray(value) || isStructuredObject(value)) return <details className="group/config min-w-0">
    <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 py-2 text-sm font-medium"><ChevronRight className="size-4 shrink-0 transition-transform group-open/config:rotate-90" /><span className="min-w-0 flex-1">{label}</span>{remove}</summary>
    <div className="flex justify-end pb-2">{typePicker}</div>
    <div className="min-w-0 pl-4"><StructuredChildren {...props} /></div>
  </details>;
  const secret = path.some((key) => typeof key === "string" && /(?:api[_-]?key|password|secret|token|authorization|credential|headers)/i.test(key));
  const field = typeof value === "boolean"
    ? <DenSwitch checked={value} onChange={(next) => change(path, next)} disabled={disabled} aria-label={label} />
    : typeof value === "number"
      ? <NumberField value={value} label={label} disabled={disabled} onChange={(next) => change(path, next)} onInvalid={(message) => invalid(path, message)} />
      : typeof value === "string"
        ? secret
          ? <DenSecretInput value={value} onChange={(next) => change(path, next)} disabled={disabled} aria-label={label} />
          : <DenInput aria-label={label} value={value} disabled={disabled} autoComplete="off" spellCheck={false} onChange={(event) => change(path, event.target.value)} />
        : null;
  return <div className="flex min-h-11 flex-wrap items-center justify-between gap-3 py-2">
    <span className="min-w-0 flex-1 text-sm">{label}</span>
    <div className="flex max-w-full flex-wrap items-center justify-end gap-2">{typePicker}<div className={typeof value === "boolean" || value === null ? "" : "w-60 max-w-full"}>{field}</div>{remove}</div>
  </div>;
}

function StructuredChildren(props: NodeProps) {
  const { value, path, change, disabled } = props;
  if (Array.isArray(value)) return <div className="divide-y divide-border">
    {value.map((item, index) => <StructuredNode key={index} {...props} value={item} path={[...path, index]} label={`第 ${index + 1} 项`} />)}
    {!value.length ? <p className="py-3 text-sm text-muted-foreground">暂无项目</p> : null}
    <div className="py-2"><DenButton type="button" variant="secondary" size="sm" disabled={disabled} onClick={() => change(path, [...value, path[path.length - 1] === "models" ? { id: "", name: "" } : ""])}><Plus className="size-4" />添加项目</DenButton></div>
  </div>;
  if (!isStructuredObject(value)) return null;
  return <div className="divide-y divide-border">
    {Object.entries(value).map(([key, child]) => <StructuredNode key={key} {...props} value={child} path={[...path, key]} label={path[path.length - 1] === "properties" && !props.suggestions ? key : props.fieldLabels[key] ?? key} />)}
    <AddOption value={value} disabled={disabled} suggestions={props.suggestions} onAdd={(key, child) => change([...path, key], child)} />
  </div>;
}

export function StructuredConfigEditor({ text, onChange, disabled = false, onValidChange, label = "提供商选项", suggestions = true, allowRootValue = false, fieldLabels }: {
  text: string; onChange: (text: string) => void; disabled?: boolean; onValidChange?: (valid: boolean) => void;
  label?: string; suggestions?: boolean; allowRootValue?: boolean;
  fieldLabels?: Record<string, string>;
}) {
  const [invalidFields, setInvalidFields] = useState<Record<string, string>>({});
  const [importError, setImportError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [beforeImport, setBeforeImport] = useState<string | null>(null);
  const [formVersion, setFormVersion] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const parsed = useMemo(() => {
    try { return { value: allowRootValue ? readStructuredValue(text) : readStructuredProvider(text), error: null }; }
    catch { return { value: undefined, error: `${label}无法读取。请重新打开后重试。` }; }
  }, [text, allowRootValue, label]);
  const valid = !importing && !parsed.error && Object.keys(invalidFields).length === 0;
  const currentValue = useRef(parsed.value);
  currentValue.current = parsed.value;
  useEffect(() => { onValidChange?.(valid); }, [valid, onValidChange]);
  return <div data-testid="structured-provider-config" className="min-w-0 text-foreground">
    <div className="flex flex-wrap items-center gap-2 py-2">
      <input ref={fileInput} className="hidden" type="file" accept=".json,.jsonc,application/json" aria-label={`导入${label}文件`} disabled={disabled || importing} onChange={async (event) => {
        const file = event.target.files?.[0];
        const originalText = text;
        event.target.value = "";
        if (!file) return;
        setImporting(true); setImportError(null);
        try {
          if (file.size > 5 * 1024 * 1024) throw new Error("file_too_large");
          const fileText = await file.text();
          const imported = allowRootValue ? readStructuredValue(fileText) : readStructuredProvider(fileText);
          setBeforeImport(originalText);
          currentValue.current = imported;
          setInvalidFields({}); setFormVersion((current) => current + 1);
          onChange(JSON.stringify(imported, null, 2));
        } catch {
          setImportError(file.size > 5 * 1024 * 1024 ? "配置文件不能超过 5 MB。" : `无法导入${label}。请选择内容完整、格式正确的 JSON 或 JSONC 文件。`);
        } finally { setImporting(false); }
      }} />
      <DenButton type="button" variant="secondary" size="sm" disabled={disabled || importing} onClick={() => fileInput.current?.click()}><Upload className="size-4" />{importing ? "正在读取…" : "导入配置文件"}</DenButton>
      {beforeImport !== null ? <DenButton type="button" variant="ghost" size="sm" disabled={disabled || importing} onClick={() => {
        try { currentValue.current = allowRootValue ? readStructuredValue(beforeImport) : readStructuredProvider(beforeImport); }
        catch { currentValue.current = undefined; }
        onChange(beforeImport); setBeforeImport(null); setImportError(null); setInvalidFields({}); setFormVersion((current) => current + 1);
      }}><Undo2 className="size-4" />撤销导入</DenButton> : null}
      {beforeImport !== null ? <p className="text-xs text-muted-foreground">已导入当前草稿</p> : null}
    </div>
    {importError ? <p role="alert" className="py-1 text-sm text-destructive">{importError}</p> : null}
    {parsed.error ? <p role="alert" className="text-sm text-destructive">{parsed.error}</p> : null}
    {Object.entries(invalidFields).map(([path, message]) => <p key={path} role="alert" className="py-1 text-sm text-destructive">{message}</p>)}
    {parsed.value !== undefined ? <StructuredNodeBody key={formVersion} value={parsed.value} path={[]} label={label} suggestions={suggestions} fieldLabels={fieldLabels ?? (suggestions ? structuredLabels : {})} editRoot={allowRootValue} disabled={disabled || importing}
      change={(path, next) => {
        if (currentValue.current === undefined) return;
        const updated = updateStructuredAtPath(currentValue.current, path, next);
        currentValue.current = updated;
        onChange(JSON.stringify(updated, null, 2));
      }}
      invalid={(path, message) => setInvalidFields((current) => {
        const key = JSON.stringify(path);
        if (current[key] === message || (!message && !Object.hasOwn(current, key))) return current;
        const next = { ...current };
        if (message) next[key] = message;
        else delete next[key];
        return next;
      })} /> : null}
  </div>;
}

function StructuredNodeBody(props: NodeProps) {
  if (props.editRoot) return <StructuredNode {...props} />;
  if (isStructuredObject(props.value) || Array.isArray(props.value)) return <StructuredChildren {...props} />;
  return <StructuredNode {...props} />;
}
