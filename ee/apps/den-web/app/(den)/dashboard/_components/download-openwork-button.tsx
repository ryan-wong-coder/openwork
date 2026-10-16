"use client";

import { Popover } from "@base-ui/react/popover";
import { Copy, Download, ExternalLink } from "lucide-react";
import { useEffect, useState } from "react";
import { DenButton } from "../../_components/ui/button";
import { installPageUrl } from "../../_lib/install-download";

export function DownloadOpenWorkButton({
  organization,
}: {
  organization?: { id: string; name: string };
}) {
  if (organization) {
    return <OrganizationDownloadPopover organizationName={organization.name} />;
  }

  return (
    <DenButton
      href="/install"
      size="sm"
      icon={Download}
      aria-label="下载 OpenWork"
      data-testid="den-download-openwork"
      className="shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900"
    >
      <span className="hidden sm:inline">下载 OpenWork</span>
    </DenButton>
  );
}

function OrganizationDownloadPopover({ organizationName }: { organizationName: string }) {
  const [copying, setCopying] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!copied) return;
    const timeout = window.setTimeout(() => setCopied(false), 1800);
    return () => window.clearTimeout(timeout);
  }, [copied]);

  function handleOpenInstallPage() {
    setError(null);
    const installWindow = window.open(installPageUrl(), "_blank");
    if (!installWindow) {
      setError("请允许弹出窗口以打开安装页面，或复制安装链接。");
      return;
    }
    installWindow.opener = null;
  }

  async function handleCopyInstallLink() {
    setCopying(true);
    setError(null);
    setCopied(false);
    try {
      await navigator.clipboard.writeText(installPageUrl());
      setCopied(true);
    } catch {
      setError("浏览器未授予复制权限。请允许剪贴板访问后重试，或打开安装页面。");
    } finally {
      setCopying(false);
    }
  }

  return (
    <Popover.Root>
      <Popover.Trigger
        render={<DenButton size="sm" icon={Download} />}
        aria-label="下载 OpenWork"
        data-testid="den-download-openwork"
        className="shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900"
      >
        <span className="hidden sm:inline">下载 OpenWork</span>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="end" sideOffset={8} className="z-50">
          <Popover.Popup
            className="w-[360px] max-w-[calc(100vw-2rem)] rounded-xl border border-gray-200 bg-white p-4 text-gray-900"
            data-testid="workspace-install-popover"
          >
            <Popover.Title className="text-[13px] font-semibold">下载此工作区的应用</Popover.Title>
            <Popover.Description className="mt-1 text-[13px] text-gray-500">
              队友将获得已连接到以下工作区的 OpenWork： {organizationName}.
            </Popover.Description>
            {error ? (
              <p className="mt-3 text-[13px] text-red-600" role="alert">
                {error}
              </p>
            ) : null}
            <div className="mt-4 flex flex-col gap-2">
              <DenButton
                className="w-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900"
                data-testid="workspace-install-open"
                icon={ExternalLink}
                onClick={handleOpenInstallPage}
              >
                打开安装页面
              </DenButton>
              <DenButton
                className="w-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900"
                data-testid="workspace-install-copy"
                icon={Copy}
                variant="secondary"
                loading={copying}
                disabled={copying}
                onClick={() => void handleCopyInstallLink()}
              >
                {copied ? "已复制" : "复制安装链接"}
              </DenButton>
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
