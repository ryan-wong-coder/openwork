"use client";

import { detectPlatform, DownloadPlatformGrid, type DetectedPlatform, type DownloadPlatformGroup, type DownloadPlatformOption } from "@openwork/ui/react";
import { Check, ChevronDown, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { requestJson } from "../_lib/den-flow";
import { getInstallConfigErrorMessage } from "../_lib/install-errors";
import { LINK_STEP, parseGuideStep, type GuideStep } from "../_lib/install-guide";
import { installDownloadHref, type InstallPlatform, installerFileName } from "../_lib/install-download";
import { isMobileUserAgent } from "../_lib/platform";
import { InstallVisual } from "./install-visual";
import { OnboardingShell } from "./onboarding-shell";
import { OrganizationBrandIdentity } from "./organization-brand-identity";

type InstallConfig = {
  appName: string;
  clientName: string;
  webUrl: string;
  apiUrl: string;
  requireSignin: boolean;
  logoUrl: string | null;
  iconUrl: string | null;
  desktopVersion: string;
  distribution: "cloud" | "enterprise";
};

const DESKTOP_SIGN_IN_PATH = "/?mode=sign-in&desktopAuth=1&desktopScheme=openwork";
const INSTALL_PLATFORMS: InstallPlatform[] = ["mac-arm64", "mac-x64", "win-x64", "linux-x64", "linux-arm64"];


type InstallerOs = "macos" | "windows" | "linux";

type OpenGuidance = {
  actions: [string, string];
  trust: { title: string; body: string } | null;
};

function detectedInstallPlatform(detected: DetectedPlatform | null): InstallPlatform | null {
  if (!detected) return null;
  if (detected.os === "windows") return "win-x64";
  if (detected.os === "macos" && detected.arch === "arm64") return "mac-arm64";
  if (detected.os === "macos" && detected.arch === "x64") return "mac-x64";
  if (detected.os === "linux" && detected.arch === "arm64") return "linux-arm64";
  if (detected.os === "linux") return "linux-x64";
  return null;
}

function installerOsFor(platform: InstallPlatform | null, detected: DetectedPlatform | null): InstallerOs | null {
  if (platform) {
    if (platform.startsWith("mac-")) return "macos";
    return platform === "win-x64" ? "windows" : "linux";
  }
  return detected?.os ?? null;
}

/** Copy for opening the downloaded installer, per operating system. */
function openGuidance(os: InstallerOs | null, fileName: string | null): OpenGuidance {
  const openFile = fileName
    ? `在“下载”文件夹中双击 ${fileName}。`
    : "打开“下载”文件夹中的 OpenWork Enterprise 安装文件。";

  if (os === "macos") {
    return {
      actions: [openFile, "将 OpenWork Enterprise 拖入“应用程序”，然后打开。"],
      trust: {
        title: "macOS 会确认从互联网下载的应用",
        body: "macOS 要求确认已签名的 OpenWork Enterprise 应用时，选择“打开”。",
      },
    };
  }
  if (os === "windows") {
    return {
      actions: [openFile, "完成 OpenWork Enterprise 安装，然后打开应用。"],
      trust: {
        title: "Windows 可能在打开安装程序前显示警告",
        body: "若看到“Windows 已保护你的电脑”，请选择“更多信息”，再选择“仍要运行”。",
      },
    };
  }
  if (os === "linux") {
    return {
      actions: [
        "为下载的 AppImage 添加执行权限。",
        "打开 OpenWork Enterprise AppImage。",
      ],
      trust: null,
    };
  }
  return {
    actions: [openFile, "在安装窗口中选择“安装”。"],
    trust: {
      title: "计算机可能在打开安装程序前要求确认",
      body: "若看到关于互联网应用的提示，请确认后打开。",
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isUrl(value: string) {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

function parseInstallConfig(value: unknown): InstallConfig | null {
  if (!isRecord(value)) {
    return null;
  }

  const clientName = typeof value.clientName === "string" ? value.clientName.trim() : "";
  const appName = typeof value.appName === "string" && value.appName.trim() ? value.appName.trim() : "OpenWork";
  const webUrl = typeof value.webUrl === "string" ? value.webUrl.trim() : "";
  const apiUrl = typeof value.apiUrl === "string" ? value.apiUrl.trim() : "";
  const requireSignin = value.requireSignin;
  const logoUrl = value.logoUrl;
  const iconUrl = value.iconUrl ?? null;
  const desktopVersion = typeof value.desktopVersion === "string" ? value.desktopVersion.trim() : "";
  const distribution = value.distribution;

  if (!clientName || !isUrl(webUrl) || !isUrl(apiUrl) || typeof requireSignin !== "boolean") {
    return null;
  }
  if (logoUrl !== null && (typeof logoUrl !== "string" || !isUrl(logoUrl))) {
    return null;
  }
  if (iconUrl !== null && (typeof iconUrl !== "string" || !isUrl(iconUrl))) {
    return null;
  }
  if (
    !desktopVersion
    || (distribution !== "cloud" && distribution !== "enterprise")
  ) {
    return null;
  }

  return {
    appName,
    clientName,
    webUrl,
    apiUrl,
    requireSignin,
    logoUrl,
    iconUrl,
    desktopVersion,
    distribution,
  };
}

async function fetchInstallConfig() {
  const { response, payload } = await requestJson(
    "/v1/me/install-config",
    { method: "GET" },
    12000,
  );
  if (!response.ok) {
    if (response.status === 401) {
      throw new Error("登录 Den 门户以安装 OpenWork。");
    }
    throw new Error(getInstallConfigErrorMessage(payload, response.status));
  }
  const parsed = parseInstallConfig(payload);
  if (!parsed) {
    throw new Error("此安装链接返回的配置信息不完整。");
  }
  return parsed;
}

type StepState = "complete" | "active" | "pending";

const STEP_BADGE: Record<StepState, string> = {
  complete: "bg-emerald-50 text-emerald-600",
  active: "bg-[#101828] text-white",
  pending: "bg-slate-100 text-slate-400",
};

function InstallStep({
  index,
  state,
  title,
  expanded,
  onExpand,
  testId,
  children,
}: {
  index: number;
  state: StepState;
  title: ReactNode;
  expanded: boolean;
  onExpand: () => void;
  testId: string;
  children: ReactNode;
}) {
  return (
    <li className="border-b border-slate-100 last:border-b-0" data-state={state} data-testid={testId}>
      <button
        type="button"
        className="flex w-full items-center gap-3.5 px-0 py-4 text-left disabled:cursor-default sm:py-[1.125rem]"
        aria-expanded={expanded}
        disabled={state === "pending"}
        onClick={onExpand}
      >
        <span className={`grid size-7 shrink-0 place-items-center rounded-full text-xs font-semibold ${STEP_BADGE[state]}`} aria-hidden="true">
          {state === "complete" ? <Check className="size-3.5" strokeWidth={2.5} /> : index}
        </span>
        <span className={`grow text-[15px] font-semibold tracking-[-0.01em] ${state === "complete" ? "text-slate-400" : "text-slate-950"}`}>{title}</span>
        <ChevronDown className={`size-4 shrink-0 text-slate-300 transition-transform ${expanded ? "rotate-180" : ""}`} aria-hidden="true" />
      </button>
      {expanded ? <div className="grid gap-3.5 pb-6 pl-[2.625rem]">{children}</div> : null}
    </li>
  );
}

export function InstallScreen() {
  const searchParams = useSearchParams();
  const [config, setConfig] = useState<InstallConfig | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isMobile, setIsMobile] = useState<boolean | null>(null);
  const [copied, setCopied] = useState(false);
  const [downloadState, setDownloadState] = useState<"idle" | "preparing" | "started">("idle");
  const [downloadLabel, setDownloadLabel] = useState("");
  const [downloadHref, setDownloadHref] = useState("");
  const [downloadPlatform, setDownloadPlatform] = useState<InstallPlatform | null>(null);
  const [detected, setDetected] = useState<DetectedPlatform | null>(null);
  const [currentLink, setCurrentLink] = useState("");
  const initialStep = parseGuideStep(searchParams.get("step"));
  const [guideStep, setGuideStep] = useState<GuideStep>(initialStep);
  const [expandedStep, setExpandedStep] = useState<GuideStep>(initialStep);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [addressCopied, setAddressCopied] = useState(false);
  const downloadStartedTimer = useRef<number | null>(null);

  useEffect(() => {
    setIsMobile(isMobileUserAgent());
    // Install pages once carried a one-off token; it is ignored now, so drop
    // it from the address before anyone copies and shares it again.
    const url = new URL(window.location.href);
    if (url.searchParams.has("token")) {
      url.searchParams.delete("token");
      window.history.replaceState(null, "", url);
    }
    setCurrentLink(url.toString());
    let cancelled = false;
    void detectPlatform().then((platform) => {
      if (!cancelled) setDetected(platform);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadConfig() {
      setBusy(true);
      setError(null);
      try {
        const parsed = await fetchInstallConfig();
        if (cancelled) {
          return;
        }
        setConfig(parsed);
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "无法加载此安装链接，请重试。");
          setConfig(null);
        }
      } finally {
        if (!cancelled) {
          setBusy(false);
        }
      }
    }

    void loadConfig();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => () => {
    if (downloadStartedTimer.current !== null) {
      window.clearTimeout(downloadStartedTimer.current);
    }
  }, []);

  const downloadGroups = useMemo<DownloadPlatformGroup[]>(() => {
    if (!config) {
      return [];
    }

    return [
      {
        os: "macos",
        title: "macOS",
        options: [
          { href: installDownloadHref("mac-arm64"), label: "Apple 芯片（M1 及更新机型）", arch: "arm64" },
          { href: installDownloadHref("mac-x64"), label: "Intel", arch: "x64" },
        ],
      },
      {
        os: "windows",
        title: "Windows",
        options: [
          { href: installDownloadHref("win-x64"), label: "x64 应用", arch: "x64" },
        ],
      },
      {
        os: "linux",
        title: "Linux",
        options: [
          { href: installDownloadHref("linux-x64"), label: "AppImage (x64)", arch: "x64" },
          { href: installDownloadHref("linux-arm64"), label: "AppImage (ARM64)", arch: "arm64" },
        ],
      },
    ];
  }, [config]);

  const platformByHref = useMemo<Record<string, InstallPlatform>>(() => {
    if (!config) {
      return {};
    }
    return Object.fromEntries(INSTALL_PLATFORMS.map((platform) => [installDownloadHref(platform), platform]));
  }, [config]);



  async function copyCurrentLink() {
    try {
      await navigator.clipboard.writeText(currentLink || window.location.href);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setConnectError("自动复制失败，请选中安装链接后手动复制。");
    }
  }

  const workspaceAddress = (() => {
    if (!currentLink) return "";
    try {
      return new URL(currentLink).origin;
    } catch {
      return "";
    }
  })();

  async function copyWorkspaceAddress() {
    try {
      await navigator.clipboard.writeText(workspaceAddress);
      setAddressCopied(true);
      window.setTimeout(() => setAddressCopied(false), 1800);
    } catch {
      setConnectError("自动复制失败，请选中地址后手动复制。");
    }
  }

  function advanceGuide(nextStep: 2 | 3) {
    setGuideStep(nextStep);
    setExpandedStep(nextStep);
    const url = new URL(window.location.href);
    url.search = "";
    window.history.replaceState(null, "", url);
  }

  function beginDownload(label: string, href: string) {
    setDownloadLabel(label);
    setDownloadHref(href);
    setDownloadPlatform(platformByHref[href] ?? null);
    setDownloadState("preparing");
    advanceGuide(2);
    if (downloadStartedTimer.current !== null) {
      window.clearTimeout(downloadStartedTimer.current);
    }
    downloadStartedTimer.current = window.setTimeout(() => {
      setDownloadState("started");
      downloadStartedTimer.current = null;
    }, 5000);
  }

  if (busy) {
    return (
      <OnboardingShell state="install-loading" width="wide" background="surface">
        <section className="grid gap-4 rounded-[1.75rem] border border-slate-200/80 bg-white p-6 md:p-8" data-testid="install-page">
          <p className="den-eyebrow">OpenWork Desktop</p>
          <h1 className="den-title-lg">正在加载安装链接。</h1>
          <p className="den-copy">正在检查团队的 OpenWork 配置…</p>
        </section>
      </OnboardingShell>
    );
  }

  if (!config) {
    return (
      <OnboardingShell state="install-error" width="wide" background="surface">
        <section className="grid gap-6 rounded-[1.75rem] border border-slate-200/80 bg-white p-6 md:p-8" data-testid="install-page">
          <div className="grid gap-2">
            <p className="den-eyebrow">OpenWork Desktop</p>
            <h1 className="den-title-lg">无法打开此安装链接。</h1>
            <p className="den-copy">{error ?? "请联系工作区管理员获取新的安装链接。"}</p>
          </div>
        </section>
      </OnboardingShell>
    );
  }

  if (config.distribution === "cloud") {
    return (
      <OnboardingShell state="install" width="full" background="surface">
        <section data-testid="install-page">
          <div className="grid gap-6 rounded-[1.75rem] border border-[#e7eaef] bg-[#fcfcfd] p-5 text-center sm:p-6 md:p-8" data-testid="install-card">
            <div className="grid justify-items-center gap-3">
              <h1 className="m-0 text-[2rem] font-semibold leading-[1.04] tracking-[-0.05em] text-slate-950 sm:text-[2.4rem]">
                下载 OpenWork
              </h1>
              <p className="den-copy max-w-2xl">选择适合你计算机的版本，安装并打开 OpenWork。</p>
            </div>

            {isMobile ? (
              <div className="den-frame-inset grid gap-3 rounded-[1.5rem] p-5 text-left" data-testid="install-mobile-note">
                <p className="m-0 text-base font-medium text-[var(--dls-text-primary)]">OpenWork 云端客户端在你的计算机上运行。</p>
                <p className="den-copy">请在 Mac、Windows 或 Linux 计算机上打开此链接。</p>
                <button type="button" className="den-button-secondary w-full sm:w-auto" onClick={() => void copyCurrentLink()}>
                  {copied ? "已复制" : "复制安装链接"}
                </button>
              </div>
            ) : (
              <div className="grid gap-5 text-left">
                <DownloadPlatformGrid groups={downloadGroups} />
                {/* Reload so the auth provider reads the desktop handoff parameters on mount. */}
                <a className="den-button-secondary w-fit" href={DESKTOP_SIGN_IN_PATH}>
                  我已安装 OpenWork
                </a>
              </div>
            )}
          </div>
        </section>
      </OnboardingShell>
    );
  }

  const installerFile = installerFileName(
    downloadPlatform ?? detectedInstallPlatform(detected),
    config.desktopVersion,
  );
  const guidance = openGuidance(installerOsFor(downloadPlatform, detected), installerFile);

  return (
    <OnboardingShell state="install" width="enterprise" background="surface">
      <section data-testid="install-page">
        <div className="grid gap-2 rounded-[1.75rem] border border-slate-200/80 bg-white p-6 text-left sm:p-8 md:px-10 md:py-9" data-testid="install-card">
          <div className="grid justify-items-start gap-2 border-b border-slate-100 pb-6">
            <span className="text-[13px] font-medium text-slate-500">
              <OrganizationBrandIdentity
                organizationName={config.clientName}
                brand={{ appName: config.appName, logoUrl: config.logoUrl, iconUrl: config.iconUrl }}
              />
            </span>
            <h1 className="m-0 text-[1.5rem] font-semibold leading-tight tracking-[-0.03em] text-slate-950 sm:text-[1.7rem]">
              配置 OpenWork Enterprise
            </h1>
          </div>

        {isMobile ? (
          <div className="grid gap-3 border-t border-slate-200 pt-5" data-testid="install-mobile-note">
            <p className="m-0 text-base font-medium text-[var(--dls-text-primary)]">{config.appName} 在你的计算机上运行。</p>
            <p className="den-copy">请在 Mac、Windows 或 Linux 计算机上打开此链接，也可以复制后发送给自己。</p>
            <button type="button" className="den-button-secondary w-full sm:w-auto" onClick={() => void copyCurrentLink()}>
              {copied ? "已复制" : "复制安装链接"}
            </button>
          </div>
        ) : (
          <ol className="grid text-left" data-testid="install-guide">
            <InstallStep
              index={1}
              state={guideStep > 1 ? "complete" : "active"}
              title="下载"
              expanded={expandedStep === 1}
              onExpand={() => setExpandedStep(1)}
              testId="install-guide-step-download"
            >
                  <DownloadPlatformGrid
                    groups={downloadGroups}
                    recommendedTestId="install-download-primary"
                    onDownload={(option: DownloadPlatformOption) => beginDownload(option.label, option.href)}
                    variant="flat"
                  />
                  <button
                    type="button"
                    className="w-fit text-sm font-medium text-slate-600 underline-offset-4 hover:text-slate-950 hover:underline"
                    onClick={() => advanceGuide(LINK_STEP)}
                    data-testid="install-skip-download"
                  >
                    已安装？跳转到第 3 步
                  </button>
                  {downloadState !== "idle" ? (
                    <div className="grid gap-2 rounded-xl border border-slate-100 bg-slate-50 p-4" aria-live="polite" data-testid="install-download-status">
                      {downloadState === "preparing" ? (
                        <>
                          <span className="size-5 animate-spin rounded-full border-2 border-[var(--dls-border-strong)] border-t-[var(--dls-accent)]" aria-hidden="true" />
                          <p className="m-0 text-sm font-medium text-slate-950">正在准备 {downloadLabel} 下载…</p>
                          <p className="m-0 text-[13px] leading-5 text-slate-500">首次下载可能需要一分钟，准备完成后浏览器会开始下载。</p>
                        </>
                      ) : (
                        <>
                          <p className="m-0 text-sm font-medium text-slate-950">下载已开始</p>
                          <p className="m-0 text-[13px] leading-5 text-slate-500">浏览器正在准备文件，若下载未出现，请重试。</p>
                          <a className="den-button-secondary w-fit" href={downloadHref} onClick={() => beginDownload(downloadLabel, downloadHref)}>
                            重试
                          </a>
                        </>
                      )}
                    </div>
                  ) : null}
            </InstallStep>

            <InstallStep
              index={2}
              state={guideStep === 2 ? "active" : guideStep > 2 ? "complete" : "pending"}
              title="安装并打开"
              expanded={expandedStep === 2 && guideStep >= 2}
              onExpand={() => setExpandedStep(2)}
              testId="install-guide-step-open"
            >
                  <div className="grid content-start gap-3">
                      <InstallVisual
                        os={installerOsFor(downloadPlatform, detected)}
                        appName={config.appName}
                        iconUrl={config.iconUrl}
                      />

                      <p className="m-0 max-w-xl text-sm leading-6 text-slate-600">{guidance.actions.join(" ")}</p>

                      {guidance.trust ? (
                        <p className="m-0 flex items-start gap-2 text-[13px] leading-5 text-amber-700" data-testid="install-os-trust-note">
                          <ShieldCheck className="mt-px size-[15px] shrink-0" aria-hidden="true" />
                          {guidance.trust.body}
                        </p>
                      ) : null}

                      <button
                        type="button"
                        className="grid min-h-10 w-fit place-items-center rounded-xl bg-[#101828] px-4 text-[13px] font-semibold text-white transition-colors hover:bg-black"
                        data-testid="install-app-ready"
                        onClick={() => advanceGuide(LINK_STEP)}
                      >
                        已打开
                      </button>
                  </div>
            </InstallStep>

            <InstallStep
              index={3}
              state={guideStep === 3 ? "active" : "pending"}
              title="连接"
              expanded={expandedStep === 3 && guideStep >= 3}
              onExpand={() => setExpandedStep(3)}
              testId="install-guide-step-link"
            >
                  <div className="grid content-start gap-3" aria-live="polite">
                      <p className="m-0 text-sm leading-6 text-slate-600">在应用中输入工作区地址：</p>

                      <div className="flex h-10 w-fit max-w-full items-stretch overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(16,24,40,0.05)]" data-testid="install-workspace-address">
                        <input
                          className="min-w-0 grow bg-transparent pl-3.5 pr-3 font-mono text-[13px] font-medium text-slate-950 outline-hidden"
                          value={workspaceAddress}
                          readOnly
                          size={Math.max(workspaceAddress.length, 12)}
                          onFocus={(event) => event.currentTarget.select()}
                        />
                        <button
                          type="button"
                          className="shrink-0 border-l border-slate-200 bg-slate-50 px-3.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-100 hover:text-slate-950"
                          onClick={() => void copyWorkspaceAddress()}
                        >
                          {addressCopied ? "已复制" : "复制"}
                        </button>
                      </div>

                      <p className="m-0 max-w-xl text-[13px] leading-5 text-slate-500">
                        然后选择“登录”，在此浏览器中完成登录后将返回应用。
                      </p>

                      {connectError ? <p className="m-0 text-sm text-red-600" role="alert">{connectError}</p> : null}
                  </div>
            </InstallStep>
          </ol>
        )}
        </div>
      </section>
    </OnboardingShell>
  );
}
