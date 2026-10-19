import { Check, Copy, PanelsTopLeft, RotateCcw } from "lucide-react";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { CanvasFence } from "./canvas-parser";
import { buildCanvasDocument, CANVAS_MESSAGE_CHANNEL, getCanvasTheme, loadCanvasChartRuntime, parseCanvasMessage } from "./canvas-document";
import { loadCanvasShellUrl } from "./canvas-sandbox";

const INITIAL_HEIGHT = 360;
const MIN_HEIGHT = 240;
const MAX_HEIGHT = 960;
const READY_TIMEOUT_MS = 15_000;

type CompleteSnapshot = { kind: CanvasFence["kind"]; source: string; title?: string };
type FrameDocument = { src: string; srcDoc: string; token: string; title?: string };

/** Tokens in a rewritten fence never replace the last complete board. */
function useCompleteSnapshot(fence: CanvasFence) {
  const [snapshot, setSnapshot] = useState<CompleteSnapshot | null>(() => fence.complete ? fence : null);
  useEffect(() => {
    if (!fence.complete) return;
    setSnapshot(current => current?.kind === fence.kind && current.source === fence.source && current.title === fence.title
      ? current : { kind: fence.kind, source: fence.source, title: fence.title });
  }, [fence.complete, fence.kind, fence.source, fence.title]);
  return snapshot;
}

function frameToken() {
  return Array.from(crypto.getRandomValues(new Uint8Array(24)), byte => byte.toString(16).padStart(2, "0")).join("");
}

function ConversationCanvasInner({ fence }: { fence: CanvasFence }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const snapshot = useCompleteSnapshot(fence);
  const [frame, setFrame] = useState<FrameDocument | null>(null);
  const [view, setView] = useState<"preview" | "source">("preview");
  const [retry, setRetry] = useState(0);
  const [height, setHeight] = useState(INITIAL_HEIGHT);
  const [state, setState] = useState<"generating" | "starting" | "ready" | "failed">("generating");
  const [copied, setCopied] = useState(false);
  const defaultTitle = fence.kind === "ant-chart" ? "图表" : fence.kind === "svg" ? "图形" : "交互画布";
  const title = snapshot?.title || frame?.title || defaultTitle;
  const sendTheme = useCallback(() => {
    if (frame) iframeRef.current?.contentWindow?.postMessage({ channel: CANVAS_MESSAGE_CHANNEL,
      token: frame.token, type: "theme", theme: getCanvasTheme(rootRef.current) }, "*");
  }, [frame]);

  useEffect(() => {
    if (!snapshot) return;
    let cancelled = false;
    setState("starting");
    const token = frameToken();
    const preparationTimeout = window.setTimeout(() => {
      if (!cancelled) { cancelled = true; setState("failed"); setView("source"); }
    }, READY_TIMEOUT_MS);
    void (async () => {
      const [shellUrl, runtimeScript] = await Promise.all([
        loadCanvasShellUrl(), snapshot.kind === "svg" ? undefined : loadCanvasChartRuntime(),
      ]);
      if (cancelled) return;
      window.clearTimeout(preparationTimeout);
      const result = buildCanvasDocument(snapshot.kind, snapshot.source, token, {
        runtimeScript, theme: getCanvasTheme(rootRef.current),
      });
      if (result.ok) {
        const url = new URL(shellUrl); url.searchParams.set("instance", token);
        setFrame({ src: url.href, srcDoc: result.srcDoc, token, title: result.title });
      }
      else { setState("failed"); setView("source"); }
    })().catch(() => {
      window.clearTimeout(preparationTimeout);
      if (!cancelled) { setState("failed"); setView("source"); }
    });
    return () => { cancelled = true; window.clearTimeout(preparationTimeout); };
  }, [snapshot?.kind, snapshot?.source, retry]);

  useLayoutEffect(() => {
    if (!frame) return;
    let ready = false;
    const timeout = window.setTimeout(() => {
      if (!ready) { setState("failed"); setView("source"); }
    }, READY_TIMEOUT_MS);
    const receive = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow || event.origin !== "null") return;
      const data: unknown = event.data;
      if (data && typeof data === "object" && "channel" in data && data.channel === CANVAS_MESSAGE_CHANNEL
        && "token" in data && data.token === frame.token && "type" in data && data.type === "shell-ready") {
        iframeRef.current?.contentWindow?.postMessage({ channel: CANVAS_MESSAGE_CHANNEL,
          token: frame.token, type: "document", srcDoc: frame.srcDoc }, "*");
        return;
      }
      const message = parseCanvasMessage(event.data, frame.token);
      if (!message) return;
      if (message.type === "ready") { ready = true; window.clearTimeout(timeout); setState("ready"); sendTheme(); }
      if (message.type === "height") setHeight(Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, Math.ceil(message.height))));
      if (message.type === "error") { ready = true; window.clearTimeout(timeout); setState("failed"); setView("source"); }
    };
    window.addEventListener("message", receive);
    return () => { window.clearTimeout(timeout); window.removeEventListener("message", receive); };
  }, [frame, sendTheme]);

  useEffect(() => {
    if (!frame) return;
    const observer = new MutationObserver(sendTheme);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class", "style"] });
    const preference = window.matchMedia("(prefers-color-scheme: dark)");
    preference.addEventListener("change", sendTheme);
    sendTheme();
    return () => { observer.disconnect(); preference.removeEventListener("change", sendTheme); };
  }, [frame, sendTheme]);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const source = snapshot?.source ?? fence.source;
  const status = state === "failed" ? "预览不可用" : !fence.complete ? "正在生成" : state === "ready" ? "" : "正在呈现";
  const frameStyle = useMemo(() => ({ height }), [height]);

  return (
    <div ref={rootRef} className="not-prose my-4 overflow-hidden rounded-xl border border-border bg-background" data-conversation-canvas={fence.ordinal} data-canvas-state={state} aria-busy={state === "generating" || state === "starting"}>
      <div className="flex h-10 items-center gap-2 border-b border-border px-3">
        <PanelsTopLeft className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.5} aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{title}</span>
        {status ? <span className="shrink-0 text-xs text-muted-foreground" role="status">{status}</span> : null}
        {state === "failed" ? <Button variant="ghost" size="icon-xs" aria-label="重试预览" title="重试预览" onClick={() => { setView("preview"); setRetry(value => value + 1); }}>
          <RotateCcw className="size-3.5" strokeWidth={1.5} aria-hidden="true" />
        </Button> : null}
        <div className="flex shrink-0 items-center" role="group" aria-label="画布视图">
          <Button variant="ghost" size="xs" aria-pressed={view === "preview"} disabled={state === "failed" && !frame} onClick={() => setView("preview")} className="aria-pressed:bg-muted">预览</Button>
          <Button variant="ghost" size="xs" aria-pressed={view === "source"} onClick={() => setView("source")} className="aria-pressed:bg-muted">源码</Button>
        </div>
      </div>
      <div hidden={view !== "preview"} className="relative" style={frameStyle} data-canvas-viewport="">
        {frame ? <iframe ref={iframeRef} title={title} src={frame.src} sandbox="allow-scripts" referrerPolicy="no-referrer"
          className="block h-full w-full border-0" aria-busy={state !== "ready"} data-canvas-frame="" /> : null}
        {!frame ? <div className={`h-full bg-muted/10${state === "failed" ? "" : " animate-pulse motion-reduce:animate-none"}`} data-canvas-placeholder="" aria-hidden="true" /> : null}
      </div>
      <div hidden={view !== "source"}>
        <pre className="m-0 whitespace-pre-wrap break-words bg-muted/20 px-4 py-3 font-mono text-xs leading-relaxed text-foreground" data-canvas-source=""><code>{source}</code></pre>
        <div className="flex justify-end border-t border-border px-3 py-1.5">
          <Button variant="ghost" size="xs" disabled={!source} onClick={() => {
            void navigator.clipboard.writeText(source).then(() => setCopied(true)).catch(() => {});
          }}>{copied ? <Check className="size-3" aria-hidden="true" /> : <Copy className="size-3" aria-hidden="true" />}{copied ? "已复制" : "复制源码"}</Button>
        </div>
      </div>
    </div>
  );
}

export const ConversationCanvas = memo(ConversationCanvasInner);
