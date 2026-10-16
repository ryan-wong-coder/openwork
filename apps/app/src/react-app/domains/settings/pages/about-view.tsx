/** @jsxImportSource react */
import { ChevronRight } from "lucide-react";
import { isZenoAboutEnabled } from "@/app/lib/zeno-about";
import { ZenoMascot, ZenoWordmark } from "@/components/brand/zeno-brand";
import { t } from "@/i18n";

// Preserve the upstream MIT notice verbatim. EE and third-party scope stays explicit below.
const OPENWORK_MIT_NOTICE = "MIT License\n\nCopyright (c) 2026 Different AI\n\nPermission is hereby granted, free of charge, to any person obtaining a copy\nof this software and associated documentation files (the \"Software\"), to deal\nin the Software without restriction, including without limitation the rights\nto use, copy, modify, merge, publish, distribute, sublicense, and/or sell\ncopies of the Software, and to permit persons to whom the Software is\nfurnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in all\ncopies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED \"AS IS\", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR\nIMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,\nFITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE\nAUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER\nLIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,\nOUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE\nSOFTWARE.\n";

/** DESIGN P1/P2/P5/P10/V1: an unboxed personal note with static, discoverable attribution. */
export function AboutView({ appVersion }: { appVersion?: string | null }) {
  if (!isZenoAboutEnabled()) return null;
  const version = appVersion?.trim() || String(import.meta.env?.VITE_OPENWORK_APP_VERSION ?? "").trim() || "—";
  return (
    <section className="flex w-full max-w-3xl flex-col gap-10" aria-label={t("zeno.about.title")} data-testid="zeno-about">
      <div className="flex flex-col items-center gap-8 sm:flex-row sm:items-start sm:gap-10">
        <ZenoMascot className="size-40 shrink-0" loading="eager" />
        <div className="min-w-0 flex-1 space-y-6">
          <div className="flex flex-wrap items-center gap-3">
            <ZenoWordmark className="h-9 w-28" decorative={false} />
            <span className="font-mono text-xs text-muted-foreground" aria-label={`${t("updates.current_version")} ${version}`}>{version}</span>
          </div>
          <div className="space-y-4 text-sm leading-relaxed">
            <p>{t("zeno.about.birthday_first")}</p>
            <p>{t("zeno.about.birthday_second")}</p>
          </div>
          <p className="text-right text-sm text-muted-foreground" data-about-signature>{t("zeno.about.signature")}</p>
        </div>
      </div>
      <div className="space-y-4 border-t border-border pt-5 text-xs text-muted-foreground">
        <p>{t("zeno.about.based_on")}</p>
        <details className="group/about-license">
          <summary className="flex w-fit cursor-pointer list-none items-center gap-2 py-2 text-xs text-muted-foreground"><ChevronRight className="size-3.5 transition-transform group-open/about-license:rotate-90 motion-reduce:transition-none" strokeWidth={1.5} />{t("zeno.about.core_license")}</summary>
          <div className="space-y-4 pt-3">
            <p>{t("zeno.about.license_scope")}</p>
            <p>Copyright (c) 2026-present Different AI, Inc.</p>
            <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed">{OPENWORK_MIT_NOTICE}</pre>
          </div>
        </details>
      </div>
    </section>
  );
}
