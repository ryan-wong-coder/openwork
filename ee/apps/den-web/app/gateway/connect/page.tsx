import type { Metadata } from "next";
import { GatewayConnect } from "./gateway-connect";

export const metadata: Metadata = {
  title: "连接 AI 网关 · OpenWork",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

export default function GatewayConnectPage() {
  return <GatewayConnect />;
}
