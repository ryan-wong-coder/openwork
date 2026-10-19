import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";

const moduleID = "virtual:zeno-canvas-chart-runtime";
const resolvedID = `\0${moduleID}`;
const entry = fileURLToPath(new URL("../src/components/markdown/canvas-chart-runtime-entry.tsx", import.meta.url));

/** The host loads one lazy string module; the opaque iframe needs no asset URL. */
export async function buildCanvasChartRuntime(): Promise<string> {
  const result = await build({
    entryPoints: [entry], bundle: true, write: false, format: "iife", platform: "browser", target: ["es2022"],
    minify: true, sourcemap: false, legalComments: "none", treeShaking: true,
    define: { "process.env.NODE_ENV": '"production"' },
    logLevel: "silent",
  });
  const output = result.outputFiles[0];
  if (!output) throw new Error("The bundled Ant Design Charts runtime is empty.");
  return output.text;
}

export function canvasChartRuntimePlugin(): Plugin {
  let pending: Promise<string> | undefined;
  const compile = () => pending ??= buildCanvasChartRuntime();
  return {
    name: "zeno-offline-ant-design-charts",
    enforce: "pre",
    resolveId(id) { return id === moduleID ? resolvedID : undefined; },
    async load(id) {
      if (id !== resolvedID) return undefined;
      return `export default ${JSON.stringify(await compile())};`;
    },
    handleHotUpdate(context) {
      if (!context.file.includes("canvas-chart-runtime-") || context.file.endsWith(".d.ts")) return;
      pending = undefined;
      const virtual = context.server.moduleGraph.getModuleById(resolvedID);
      if (virtual) {
        context.server.moduleGraph.invalidateModule(virtual);
        return [virtual, ...context.modules];
      }
    },
  };
}
