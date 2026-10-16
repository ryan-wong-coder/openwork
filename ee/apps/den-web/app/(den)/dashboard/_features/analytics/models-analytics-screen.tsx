"use client";

import { useQuery } from "@tanstack/react-query";
import { DenButton } from "../../../_components/ui/button";
import { DenNotice } from "../../../_components/ui/notice";
import { getErrorMessage, requestJson } from "../../../_lib/den-flow";
import { redirect } from "next/navigation";
import { getAnalyticsRoute, getInferenceRoute, orgFeatureEnabled } from "../../../_lib/den-org";
import { parseInferencePayload } from "../../../_lib/inference-status";
import { useDenFlow } from "../../../_providers/den-flow-provider";
import { ModelsAnalyticsPanel } from "../../_components/models-analytics-panel";
import { useOrgDashboard } from "../../_providers/org-dashboard-provider";
import { AnalyticsEmptyState, AnalyticsErrorState, AnalyticsLoading, AnalyticsPageHeader, analyticsPageClass, analyticsSurfaceClass } from "./analytics-layout";
import { UsageLimitsCard } from "./usage-limits-card";

export function ModelsAnalyticsScreen() {
  const { activeOrg, orgContext } = useOrgDashboard();
  if (!orgContext) return <AnalyticsLoading label="正在加载分析数据" />;
  if (!orgFeatureEnabled(orgContext, "modelsAnalyticsUi")) redirect(getAnalyticsRoute(activeOrg?.slug));
  return <EnabledModelsAnalyticsScreen />;
}

function EnabledModelsAnalyticsScreen() {
  const { activeOrg, orgContext } = useOrgDashboard();
  const { runtimeConfig, runtimeConfigLoaded } = useDenFlow();
  const hosted = runtimeConfigLoaded && runtimeConfig.orgMode === "multi_org";
  const status = useQuery({
    queryKey: ["models-usage-limits", orgContext?.organization.id],
    enabled: hosted && Boolean(orgContext),
    refetchInterval: 30_000,
    queryFn: async () => {
      const { response, payload } = await requestJson("/v1/inference/analytics/usage", { method: "GET" }, 12000);
      if (!response.ok) throw new Error(getErrorMessage(payload, "无法加载模型用量，请重试。"));
      const parsed = parseInferencePayload(payload);
      if (!parsed) throw new Error("无法加载模型用量，请重试。");
      return parsed;
    },
  });

  return <div className={analyticsPageClass}>
    <AnalyticsPageHeader orgSlug={activeOrg?.slug} active="models" title="模型与用量" />
    {!runtimeConfigLoaded ? <AnalyticsLoading label="正在加载模型用量" /> : !hosted ? (
      <div className={analyticsSurfaceClass}><AnalyticsEmptyState title="OpenWork 云端提供 OpenWork 模型">
        “用量与采用率”包含已连接提供商的活动。
      </AnalyticsEmptyState></div>
    ) : <>
      {status.isError ? !status.data ? <AnalyticsErrorState title="无法加载模型用量" onRetry={() => void status.refetch()} retrying={status.isFetching} /> : <DenNotice tone="neutral" presentation="inline" message="刷新失败，当前显示上次用量。" action={<DenButton variant="secondary" size="sm" disabled={status.isFetching} onClick={() => void status.refetch()}>重试</DenButton>} /> : null}
      {status.isPending ? <AnalyticsLoading label="正在加载模型用量" /> : null}
      {status.data?.enabled && status.data.subscribed ? <>
        <UsageLimitsCard buckets={status.data.buckets} />
        <ModelsAnalyticsPanel key={orgContext?.organization.id} />
      </> : status.data ? <div className={analyticsSurfaceClass}>
        <AnalyticsEmptyState title="OpenWork 模型已包含模型洞察"
          action={<DenButton href={getInferenceRoute(activeOrg?.slug)}>配置 OpenWork 模型</DenButton>} />
      </div> : null}
    </>}
  </div>;
}
