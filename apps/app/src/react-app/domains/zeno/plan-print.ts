import { planPdfData, type TrainingRoutine } from "@zeno/fitness";

/** A separate same-origin document keeps navigation/dialog backdrops off paper.
 * All user text is assigned through textContent, never parsed as markup.
 */
export async function printFitnessPlan(routine: TrainingRoutine): Promise<void> {
  const plan = planPdfData(routine), frame = document.createElement("iframe");
  frame.title = "训练计划打印"; frame.setAttribute("aria-hidden", "true");
  Object.assign(frame.style, { position: "fixed", width: "1px", height: "1px", left: "-10000px", border: "0" });
  document.body.append(frame);
  const view = frame.contentWindow, doc = frame.contentDocument;
  if (!view || !doc) { frame.remove(); throw new Error("浏览器暂时无法打印，请重试。"); }
  const cleanup = () => frame.remove();
  try {
    doc.title = plan.title;
    doc.documentElement.lang = "zh-CN";
    const style = doc.createElement("style");
    style.textContent = "@page{size:A4;margin:18mm}body{color:#162e2a;font:11pt/1.6 system-ui,'PingFang SC','Microsoft YaHei',sans-serif}h1{font-size:24pt;margin:0 0 6mm}h2{font-size:12pt;margin:0 0 2mm}header{border-bottom:1px solid #78908a;padding-bottom:5mm}header p{font-size:9pt;letter-spacing:.15em}section{padding:5mm 0;border-bottom:1px solid #d4ddda;break-inside:avoid}p{margin:2mm 0;white-space:pre-wrap;overflow-wrap:anywhere}small{color:#526a64}footer{margin-top:8mm;font-size:9pt;color:#526a64}";
    doc.head.append(style);
    const append = (parent: HTMLElement, tag: string, text: string) => { const node = doc.createElement(tag); node.textContent = text; parent.append(node); return node; };
    const header = doc.createElement("header"); append(header, "p", "泽诺 ZENO"); append(header, "h1", plan.title); doc.body.append(header);
    if (routine.description) append(doc.body, "p", routine.description);
    for (const [index, entry] of plan.exercises.entries()) {
      const section = doc.createElement("section"); append(section, "h2", `${index + 1}. ${entry.name}`);
      append(section, "p", entry.sets.join("\n")); append(section, "small", `休息 ${entry.restSeconds} 秒${entry.groupId ? " · 超级组" : ""}`);
      if (entry.notes) append(section, "p", entry.notes); doc.body.append(section);
    }
    append(doc.body, "footer", `${plan.exercises.length} 个动作 · ${new Intl.DateTimeFormat("zh-CN").format(Date.now())}`);
    await doc.fonts.ready;
    await new Promise<void>(resolve => window.requestAnimationFrame(() => resolve()));
    view.addEventListener("afterprint", cleanup, { once: true });
    view.print();
    // Some browsers omit afterprint; leave enough time for print preview.
    window.setTimeout(cleanup, 60000);
  } catch (error) { cleanup(); throw error; }
}
