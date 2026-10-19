/** JSON-compatible Ant Design Charts configuration; callback source is never evaluated. */
export const canvasChartTypes = [
  "Line", "Area", "Column", "Bar", "Pie", "Scatter", "Heatmap", "Radar", "Funnel",
  "FlowGraph", "MindMap", "OrganizationChart", "NetworkGraph", "IndentedTree",
] as const;

export type CanvasChartType = typeof canvasChartTypes[number];

export interface CanvasChartSpecification {
  type: CanvasChartType;
  data: unknown;
  [option: string]: unknown;
}

export interface CanvasChartTheme {
  dark: boolean;
  background: string;
  text: string;
  muted: string;
  grid: string;
  accent: string;
  palette: string[];
  fontFamily: string;
}

export interface CanvasChartHandle {
  readonly ready: Promise<void>;
  update(specification: Partial<CanvasChartSpecification>): Promise<void>;
  resize(): Promise<void>;
  destroy(): void;
}

export interface CanvasChartsRuntime {
  readonly version: "2.6.5";
  readonly ready: Promise<void>;
  readonly types: readonly CanvasChartType[];
  render(element: HTMLElement | string, specification: CanvasChartSpecification): CanvasChartHandle;
}

declare global {
  interface Window {
    ZenoCharts: CanvasChartsRuntime;
    __ZENO_CHART_THEME__?: Partial<CanvasChartTheme>;
  }
}
