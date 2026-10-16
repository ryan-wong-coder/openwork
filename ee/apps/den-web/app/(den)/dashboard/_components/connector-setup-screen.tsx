"use client";

import { UserPlus } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { DenButton } from "../../_components/ui/button";
import {
  getLibraryAddConnectorRoute,
  getLibraryConnectorShareRoute,
  getLibraryRoute,
} from "../../_lib/den-org";
import { useOrgDashboard } from "../_providers/org-dashboard-provider";
import { shortDescription } from "./connector-picker";
import { type ConnectorTarget, useConnectorSetup } from "./connector-setup";
import { ItemHeader, ItemPage, StepFooter } from "./item-header";
import { LinkButton } from "./item-list";
import { ConnectorLogo } from "./item-logo";
import { useMcpConnectionPresets } from "./mcp-connections-data";
import { SetupChecks } from "./setup-checks";

export function useConnectorTarget(catalogId: string): { target: ConnectorTarget | null; loading: boolean; missing: boolean; failed: boolean } {
  const searchParams = useSearchParams();
  const presets = useMcpConnectionPresets();
  const customUrl = searchParams.get("url");
  const customName = searchParams.get("name");
  return useMemo(() => {
    if (catalogId === "custom") {
      if (!customUrl) return { target: null, loading: false, missing: true, failed: false };
      return { target: { name: customName?.trim() || "MCP 服务器", url: customUrl, description: "" }, loading: false, missing: false, failed: false };
    }
    const preset = presets.data?.find((entry) => entry.presetId === catalogId);
    if (!preset && presets.error) return { target: null, loading: false, missing: false, failed: true };
    if (!preset) return { target: null, loading: presets.isLoading, missing: !presets.isLoading, failed: false };
    return {
      target: {
        name: preset.displayName,
        url: preset.url,
        description: shortDescription(preset.description),
        preset: { authType: preset.authType, requiresOAuthClient: preset.requiresOAuthClient, defaultOAuthClientId: preset.defaultOAuthClientId },
      },
      loading: false,
      missing: false,
      failed: false,
    };
  }, [catalogId, customName, customUrl, presets.data, presets.error, presets.isLoading]);
}

/** A4 and A5: the checks fill in, the member signs in, and the connector is theirs. */
export function MemberConnectorSetupScreen({ catalogId }: { catalogId: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { orgSlug } = useOrgDashboard();
  const { target, loading, missing, failed } = useConnectorTarget(catalogId);
  const [leaving, setLeaving] = useState(false);
  const setup = useConnectorSetup({
    target,
    initialConnectionId: searchParams.get("connection"),
    onConnectionCreated: (connectionId) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("connection", connectionId);
      router.replace(`?${params.toString()}`, { scroll: false });
    },
  });

  const name = target?.name ?? "";
  const back = { href: getLibraryAddConnectorRoute(orgSlug), label: "添加连接器" };

  if (missing || failed) {
    return (
      <ItemPage>
        <ItemHeader
          back={back}
          title={failed ? "列表加载失败" : "未找到连接器"}
          description={failed ? "请重新加载页面后重试。" : "请从列表中重新选择。"}
        />
      </ItemPage>
    );
  }
  if (!target) {
    return <ItemPage><ItemHeader back={back} title={loading ? "正在加载…" : "添加连接器"} /></ItemPage>;
  }

  const checks = setup.checks.map((check) => check.id === "sign-in" && setup.canSignIn
    ? { ...check, action: <DenButton size="sm" onClick={() => void setup.startSignIn()}>{`使用 ${name} 登录`}</DenButton> }
    : check);

  async function cancel() {
    setLeaving(true);
    await setup.discard();
    router.push(getLibraryRoute(orgSlug));
  }

  return (
    <ItemPage testId="connector-setup">
      <ItemHeader
        back={back}
        logo={<ConnectorLogo name={name} url={target.url} size="md" />}
        title={setup.allDone ? `${name} 已就绪` : `连接 ${name}`}
        description={setup.allDone
          ? "仅你自己可使用，团队需要时可共享。"
          : `OpenWork 将检查 ${name}，然后请你登录。此连接仅供你使用。`}
      />
      <SetupChecks checks={checks} />
      {setup.allDone && setup.connectionId ? (
        <StepFooter note={`已完成全部 ${checks.length} 步骤`}>
          <LinkButton href={getLibraryConnectorShareRoute(orgSlug, setup.connectionId)}>
            <UserPlus className="h-4 w-4" aria-hidden />
            分享
          </LinkButton>
          <LinkButton variant="primary" href={getLibraryRoute(orgSlug)}>完成</LinkButton>
        </StepFooter>
      ) : (
        <StepFooter note={`步骤 ${setup.stepNumber} / ${checks.length}`}>
          <DenButton variant="secondary" loading={leaving} onClick={() => void cancel()}>取消</DenButton>
        </StepFooter>
      )}
    </ItemPage>
  );
}
