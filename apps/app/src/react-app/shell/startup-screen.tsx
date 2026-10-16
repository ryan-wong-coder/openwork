/** @jsxImportSource react */
import { t } from "@/i18n";
import { use, type ReactNode } from "react";
import { isOpenworkGatewayRuntime } from "@/app/lib/gateway-runtime";
import { isZenoInterfaceEnabled } from "@/app/lib/zeno-identity";
import { WebStartupScreen } from "./workspace-startup-status";

// Startup gates cannot depend on the providers they are still waiting to mount.
export function StartupScreen({ message }: { message?: string }) {
  const zenoEnabled = isZenoInterfaceEnabled();
  const startupMessage = message ?? t(zenoEnabled ? "zeno.starting" : "interface.starting_openwork");
  if (isOpenworkGatewayRuntime() && !zenoEnabled) return <WebStartupScreen message={startupMessage} />;
  return (
    <div className="flex min-h-dvh items-center justify-center bg-dls-surface p-6 text-dls-primary">
      <div className="flex max-w-sm flex-col items-center gap-4 text-center text-sm">
        <p role="status" aria-live="polite">{startupMessage}</p>
        <p className="text-dls-secondary">{t("interface.if_startup_does_not_finish_reload_to_try_again")}</p>
        <button
          type="button"
          className="rounded-md border border-dls-border px-3 py-2 font-medium"
          onClick={() => window.location.reload()}
        >{t("interface.reload")} </button>
      </div>
    </div>
  );
}

export function StartupApp({ startup }: { startup: Promise<ReactNode> }) {
  return use(startup);
}
