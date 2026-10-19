import { Lexer } from "marked";

export type CanvasKind = "html" | "svg" | "ant-chart";

export type CanvasFence = {
  ordinal: number;
  kind: CanvasKind;
  source: string;
  complete: boolean;
  title?: string;
};

export type CanvasSegment =
  | { type: "markdown"; text: string }
  | { type: "canvas"; fence: CanvasFence };

function canvasKind(info: string): CanvasKind | null {
  const [language, marker] = info.trim().toLowerCase().split(/\s+/);
  if (language === "zeno-html" || (language === "html" && marker === "canvas")) return "html";
  if (language === "svg" || language === "zeno-svg") return "svg";
  if (["ant-chart", "ant-design-chart", "ant-design-charts"].includes(language ?? "")) return "ant-chart";
  return null;
}

/** Only explicit, top-level board fences execute. Ordinary HTML stays source. */
export function parseConversationCanvas(text: string): CanvasSegment[] {
  const input = text.replace(/\r\n?/g, "\n");
  const segments: CanvasSegment[] = [];
  let cursor = 0;
  let proseStart = 0;
  let ordinal = 0;
  // Use the same CommonMark lexer as prose. Do not recurse into list items,
  // quotations, raw HTML or ordinary code examples looking for executable code.
  for (const token of Lexer.lex(input, { gfm: true })) {
    const start = input.indexOf(token.raw, cursor);
    if (start < 0) continue;
    cursor = start + token.raw.length;
    if (token.type !== "code" || !("lang" in token) || typeof token.lang !== "string") continue;
    const kind = canvasKind(token.lang);
    if (!kind) continue;
    const opening = /^ {0,3}(`{3,}|~{3,})[^\n]*(?:\n|$)/.exec(token.raw);
    const mark = opening?.[1];
    if (!mark) continue;
    const body = token.raw.slice(opening[0].length);
    const closing = new RegExp(`(?:^|\\n) {0,3}${mark[0]}{${mark.length},}[\\t ]*(?:\\n)?$`).exec(body);
    const titleMatch = /(?:^|\s)title=(?:"([^"\r\n]{1,120})"|'([^'\r\n]{1,120})')/.exec(token.lang);
    const title = titleMatch?.[1] ?? titleMatch?.[2];
    if (start > proseStart) segments.push({ type: "markdown", text: input.slice(proseStart, start) });
    segments.push({ type: "canvas", fence: {
      ordinal: ordinal++, kind, source: closing ? body.slice(0, closing.index + (body[closing.index] === "\n" ? 1 : 0)) : body,
      complete: closing !== null, ...(title ? { title } : {}),
    } });
    proseStart = cursor;
  }
  if (proseStart < input.length) segments.push({ type: "markdown", text: input.slice(proseStart) });
  return segments;
}
