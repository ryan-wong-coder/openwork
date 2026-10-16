"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LockKeyhole } from "lucide-react";
import { INFERENCE_MODEL_ALIASES } from "@openwork/types/den/inference";
import { DenButton } from "../../_components/ui/button";
import { DenPageHeader } from "../../_components/ui/page-header";
import { DenCard } from "../../_components/ui/card";
import { DenNotice } from "../../_components/ui/notice";
import { parseInferencePayload, type InferenceStatus } from "../../_lib/inference-status";
import { DenSectionHeader } from "../../_components/ui/section-header";
import { DenTable, type DenTableColumn } from "../../_components/ui/table";
import { getErrorMessage, getRequestError, requestJson } from "../../_lib/den-flow";
import { getBillingRoute, getCustomLlmProvidersRoute, getOrgAccessFlags } from "../../_lib/den-org";
import { useDenFlow } from "../../_providers/den-flow-provider";
import { useOrgDashboard } from "../_providers/org-dashboard-provider";
import { getGatewayDashboardAccess } from "../_lib/gateway-dashboard-access";
import { UsageLimitsCard } from "../_features/analytics/usage-limits-card";

/**
 * Editorial detail per model: what a knowledge worker should reach for it for,
 * and the vendor monogram shown in the lineup table. Keyed by model alias so
 * unmapped models still render with sane defaults.
 */
const MODEL_DETAILS: Record<string, { bestFor: string; monogram: string } | undefined> = {
  "moonshotai/kimi-k3": { bestFor: "研究与综合分析", monogram: "MS" },
  "z-ai/glm-5.2": { bestFor: "多步骤任务", monogram: "ZA" },
  "moonshotai/kimi-k2.7-code": { bestFor: "电子表格与脚本", monogram: "MS" },
  "tencent/hy3-preview": { bestFor: "长文档", monogram: "TC" },
  "moonshotai/kimi-k2.6": { bestFor: "日常写作", monogram: "MS" },
  "deepseek/deepseek-v4-flash": { bestFor: "快速总结", monogram: "DS" },
  "minimax/minimax-m2.7": { bestFor: "工具与集成", monogram: "MM" },
  "minimax/minimax-m3": { bestFor: "图像与截图", monogram: "MM" },
  "z-ai/glm-5.1": { bestFor: "均衡的默认选择", monogram: "ZA" },
};

type LineupModel = {
  id: string;
  name: string;
  bestFor: string;
  monogram: string;
};

const MODEL_LINEUP: LineupModel[] = Object.entries(INFERENCE_MODEL_ALIASES)
  .filter(([, model]) => model.enabled)
  .map(([id, model]) => {
    const detail = MODEL_DETAILS[id];
    return {
      id,
      name: model.displayName.replace(/^OpenWork:\s*/, ""),
      bestFor: detail?.bestFor ?? "通用知识工作",
      monogram: detail?.monogram ?? id.split("/")[0].slice(0, 2).toUpperCase(),
    };
  });

const MODEL_COLUMNS: readonly DenTableColumn<LineupModel>[] = [
  {
    key: "model",
    header: "模型",
    render: (model) => (
      <div className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[7px] bg-gray-100 text-[9px] font-semibold tracking-[0.02em] text-gray-500"
        >
          {model.monogram}
        </span>
        <span className="text-[13px] font-medium text-gray-900">{model.name}</span>
      </div>
    ),
  },
  {
    key: "bestFor",
    header: "适用场景",
    width: "190px",
    render: (model) => <span className="text-[13px] text-gray-500">{model.bestFor}</span>,
  },
  {
    key: "id",
    header: "模型 ID",
    width: "230px",
    render: (model) => <span className="whitespace-nowrap font-mono text-[12px] text-gray-500">{model.id}</span>,
  },
];

function ModelsLineup({ subscribed }: { subscribed: boolean }) {
  return (
    <section className="grid gap-3.5">
      <DenSectionHeader
        title="模型"
        description={
          subscribed
            ? `工作区的每位成员都可以使用全部 ${MODEL_LINEUP.length} 个模型。`
            : `订阅后，工作区的每位成员都可以立即使用全部 ${MODEL_LINEUP.length} 个模型。`
        }
      />
      <div className="overflow-hidden rounded-[16px] border border-gray-100 bg-white">
        <DenTable headerTone="plain" columns={MODEL_COLUMNS} rows={MODEL_LINEUP} getRowKey={(model) => model.id} />
      </div>
    </section>
  );
}

export function InferenceScreen({ embedded = false }: { embedded?: boolean }) {
  const router = useRouter();
  const { runtimeConfig, runtimeConfigLoaded } = useDenFlow();
  const dashboard = useOrgDashboard();
  const gatewayAccess = getGatewayDashboardAccess(dashboard);
  const checking = gatewayAccess === "checking" || !runtimeConfigLoaded;
  const access = getOrgAccessFlags(
    dashboard.orgContext?.currentMember.role ?? "member",
    dashboard.orgContext?.currentMember.isOwner ?? false,
    dashboard.orgContext?.currentMember.permissions,
  );
  const locked = !checking && !access.canViewModelsSettings;
  const redirect = !locked && runtimeConfig.orgMode === "single_org" ? getCustomLlmProvidersRoute(dashboard.orgSlug) : null;

  useEffect(() => {
    if (!checking && !dashboard.orgError && redirect) router.replace(redirect);
  }, [checking, dashboard.orgError, redirect, router]);

  if (dashboard.orgError && !checking) return <DenNotice tone="error" message={dashboard.orgError} />;
  if (locked) {
    return <div data-testid="models-access-state" data-access-state="denied">
      <DenNotice tone="neutral" icon={LockKeyhole} message="查看 OpenWork 模型需要“查看 OpenWork 模型设置”权限，请联系组织所有者或管理员授权。" />
    </div>;
  }
  if (checking || redirect) {
    return <div className="flex min-h-[320px] items-center justify-center px-6 text-[14px] text-gray-500" data-testid="models-access-state" data-access-state={checking ? "checking" : "redirecting"}>
      {checking ? "正在检查工作区访问权限…" : "正在跳转到提供商…"}
    </div>;
  }

  // Do not mount data fetching or management actions until this workspace is verified.
  return <InferenceContent key={dashboard.orgId} embedded={embedded} />;
}

function InferenceContent({ embedded }: { embedded: boolean }) {
  const router = useRouter();
  const { activeOrg, orgContext, refreshOrgData, runReauthableAction } = useOrgDashboard();
  const [status, setStatus] = useState<InferenceStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [subscribeBusy, setSubscribeBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const access = getOrgAccessFlags(
    orgContext?.currentMember.role ?? "member",
    orgContext?.currentMember.isOwner ?? false,
    orgContext?.currentMember.permissions,
  );
  // Subscribing starts a billing checkout; enabling changes the inference setting.
  const canSubscribe = access.canManageBilling;
  const canToggleModels = access.canManageModelsSettings;
  const activeOrgSlug = activeOrg?.slug ?? null;

  async function loadStatus() {
    setLoading(true);
    setError(null);
    try {
      const { response, payload } = await requestJson("/v1/inference", { method: "GET" }, 12000);
      if (!response.ok) {
        throw new Error(getErrorMessage(payload, `无法加载推理设置（${response.status}）。`));
      }
      const parsed = parseInferencePayload(payload);
      if (!parsed) {
        throw new Error("推理设置返回的信息不完整，请重试。");
      }
      setStatus(parsed);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "无法加载推理设置，请重试。");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadStatus();
  }, [orgContext?.organization.id]);

  // Subscribe at the point of value: start the Stripe checkout right here
  // instead of bouncing the user to the billing page. Billing stays the
  // status/portal view.
  async function startSubscribeCheckout() {
    if (!canSubscribe) {
      setError("购买 OpenWork 模型需要“管理账单”权限。");
      return;
    }

    setError(null);
    try {
      await runReauthableAction("inference-checkout", async () => {
        setSubscribeBusy(true);
        const { response, payload } = await requestJson(
          "/v1/billing/stripe/checkout",
          { method: "POST", body: JSON.stringify({ type: "inference" }) },
          12000,
        );
        if (!response.ok) {
          throw getRequestError(payload, response, `结账失败（${response.status}）。`);
        }
        const url = payload && typeof payload === "object" && "url" in payload && typeof payload.url === "string" ? payload.url : null;
        if (!url) {
          throw new Error("结账响应缺少地址，请重试。");
        }
        window.location.href = url;
      });
    } catch (checkoutError) {
      setError(checkoutError instanceof Error ? checkoutError.message : "无法开始结账，请重试。");
      setSubscribeBusy(false);
    }
  }

  async function toggleEnabled() {
    if (!status) return;
    if (status.enabled || !status.subscribed) {
      router.push(getBillingRoute(activeOrg?.slug));
      return;
    }
    if (!canToggleModels) {
      setError("启用 OpenWork 模型需要“管理 OpenWork 模型”权限。");
      return;
    }
    setError(null);
    try {
      await runReauthableAction("update-inference", async () => {
        setSaving(true);
        try {
          const { response, payload } = await requestJson(
            "/v1/inference",
            {
              method: "PATCH",
              body: JSON.stringify({ enabled: !status.enabled, tier: status.tier }),
            },
            20000,
          );
          if (!response.ok) {
            throw getRequestError(payload, response, `无法更新推理设置（${response.status}）。`);
          }
          const parsed = parseInferencePayload(payload);
          if (!parsed) {
            throw new Error("推理设置返回的信息不完整，请重试。");
          }
          setStatus(parsed);
          await refreshOrgData();
        } finally {
          setSaving(false);
        }
      });
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "更新推理设置失败，请重试。");
    }
  }

  const enabled = status?.enabled === true;
  const subscribed = status?.subscribed === true;
  const showGettingStarted = !loading && status !== null && !subscribed;
  const memberCount = status?.memberCount ?? 0;
  const actionLabel = subscribed ? (enabled ? "管理订阅" : "启用") : "订阅";
  const memberCaption = memberCount > 0
    ? `${memberCount} 名活跃成员`
    : "按活跃成员计费";

  const description = "为知识工作精选的可靠模型，无需管理 API 密钥。";
  const caption = `10 美元 / 人 / 月 · ${memberCaption}`;
  const actionLockReason = !subscribed
    ? (canSubscribe ? null : "订阅需要“管理账单”权限。")
    : enabled
      ? (access.canViewBilling ? null : "管理订阅需要“查看账单”权限。")
      : (canToggleModels ? null : "启用 OpenWork 模型需要“管理 OpenWork 模型”权限。");
  const action = <DenButton type="button" onClick={subscribed ? toggleEnabled : () => void startSubscribeCheckout()}
    loading={loading || saving || subscribeBusy} disabled={actionLockReason !== null} variant={enabled ? "secondary" : "primary"}>
    {actionLabel}
  </DenButton>;

  return (
    <div className={embedded ? "grid gap-6" : "mx-auto grid w-full max-w-[960px] gap-6 px-4 pb-12 pt-5 sm:px-6 lg:px-8"}>
      {embedded ? <DenSectionHeader title="OpenWork 模型"
        description={<>{description}<span className="block">{caption}</span></>}
        action={action} /> : <DenPageHeader title="OpenWork 模型"
        description={description} caption={caption} action={action} />}

      {error ? <DenNotice message={error} tone="error" /> : null}

      {actionLockReason === null ? null : (
        <DenNotice
          tone="neutral"
          icon={LockKeyhole}
          message={`${actionLockReason} 请联系组织所有者或管理员获取权限。`}
        />
      )}

      {showGettingStarted ? <DenCard>
        <p className="text-sm leading-6 text-[#637291]">一次订阅即可为工作区所有人启用模型。订阅后，在应用的 OpenWork 分组中选择模型并开始任务。</p>
      </DenCard> : null}

      {enabled && status ? <UsageLimitsCard buckets={status.buckets} /> : null}

      <ModelsLineup subscribed={subscribed} />

      <p className="text-[13px] text-gray-400">
        希望使用自有提供商账户？{" "}
        <Link href={getCustomLlmProvidersRoute(activeOrgSlug)} className="text-gray-900 underline">
          配置自有密钥。
        </Link>
      </p>
    </div>
  );
}
