import geometry from "../upstream/lib/body-paths.js";
import { list, record, text } from "./value.js";

function hex(value: string, fallback: string): string { return /^#[a-f\d]{3}(?:[a-f\d]{3})?$/i.test(value) ? value : fallback; }
const escape = (value: string): string => value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
/** MIT MuscleMap-derived geometry only. Contains no Gym visual exercise artwork. */
export function muscleMapSvg(options: { figure?: "male" | "female"; view?: "front" | "back"; values?: Readonly<Record<string, number>>; foreground?: string; inactive?: string } = {}): string {
  const source = record(geometry); const figure = record(source[options.figure ?? "male"]); const view = record(figure[options.view ?? "front"]);
  const paths = record(view.p); const active = hex(options.foreground ?? "#16a394", "#16a394"); const inactive = hex(options.inactive ?? "#dce3e1", "#dce3e1");
  const content = Object.entries(paths).flatMap(([muscle, raw]) => list(raw).filter((path): path is string => typeof path === "string").map(path => `<path d="${escape(path)}" fill="${(options.values?.[muscle] ?? 0) > 0 ? active : inactive}" opacity="${(options.values?.[muscle] ?? 0) > 0 ? Math.max(0.2, Math.min(1, options.values?.[muscle] ?? 0)) : 1}"/>`)).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${escape(text(view.vb, "0 0 800 1400"))}" role="img" aria-label="肌群图">${content}</svg>`;
}
/** Original geometric category illustration; deliberately does not depict a specific exercise. */
export function exerciseCategorySvg(category = "strength", color = "#16a394"): string {
  const stroke = hex(color, "#16a394");
  const shapes: Record<string, string> = {
    strength: '<path d="M32 64h64M32 44v40M42 50v28M86 50v28M96 44v40"/>',
    cardio: '<path d="M20 68h25l10-24 16 40 12-24h25"/>',
    stretching: '<circle cx="64" cy="28" r="8"/><path d="M64 40v28M38 44l26 8 26-8M64 68L40 98M64 68l24 30"/>',
    yoga: '<circle cx="64" cy="30" r="8"/><path d="M64 42v25M64 49L42 66M64 49l22 17M64 67L38 91h52Z"/>',
  };
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" fill="none" stroke="${stroke}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" role="img" aria-label="训练类别图示">${shapes[category] ?? shapes.strength}</svg>`;
}
