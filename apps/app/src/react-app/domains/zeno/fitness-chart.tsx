import { useSyncExternalStore } from "react";
import { Line } from "@ant-design/plots";
import { getResolvedThemeMode, subscribeToTheme } from "@/app/theme";

export default function FitnessTrendChart({ data, unit }: { data: { date: string; value: number }[]; unit: string }) {
  const theme = useSyncExternalStore(subscribeToTheme, getResolvedThemeMode, getResolvedThemeMode);
  const color = getComputedStyle(document.documentElement).getPropertyValue("--primary").trim();
  return <div data-zeno-fitness-chart className="h-64 min-w-0 w-full"><Line data={data} xField="date" yField="value" height={256} autoFit theme={theme === "dark" ? "classicDark" : "classic"} style={{ stroke: color }} axis={{ x: { title: false }, y: { title: unit } }} point={{ size: 3, shape: "circle" }} tooltip={{ title: "date" }} animate={false} /></div>;
}
