"use client";

import { DEFAULT_DEN_LOCALE, denBillingIntervalLabel } from "../../../_lib/locale";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, CreditCard, RefreshCw } from "lucide-react";
import { DenButton } from "../../_components/ui/button";
import { DenActionList, DenActionRow } from "../../_components/ui/action-row";
import { DenBadge } from "../../_components/ui/badge";
import { DenCard } from "../../_components/ui/card";
import { DenLineItemRow, DenMarkTile } from "../../_components/ui/line-item-row";
import { DenNotice } from "../../_components/ui/notice";
import { DenSectionHeader } from "../../_components/ui/section-header";
import { DenUsageMeter } from "../../_components/ui/usage-meter";
import { formatMoneyMinor, formatSubscriptionStatus, getErrorMessage, getRequestError, requestJson } from "../../_lib/den-flow";
import { DashboardPageTemplate } from "../../_components/ui/dashboard-page-template";
import { getInferenceRoute, getMembersRoute, getOrgAccessFlags, getWebRoute, permissionLockReason } from "../../_lib/den-org";
import { ORG_SCOPE_HEADER } from "../../_lib/org-scope";
import { useDenFlow } from "../../_providers/den-flow-provider";
import {
  getOpenWorkWebQuantityDescription,
  OPENWORK_WEB_QUANTITY_EXPLANATION,
  parseStripeWebBilling,
  type StripeWebBilling,
} from "../_lib/stripe-web-billing";
import { useOrgDashboard } from "../_providers/org-dashboard-provider";

type StripeBilling = {
  configured: boolean;
  priceId: string | null;
  unitAmount: number;
  currency: string;
  interval: string;
  memberCount: number;
  hasActiveSubscription: boolean;
  portalUrl: string | null;
  subscription: {
    status: string;
    quantity: number;
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
  } | null;
  seats: StripeSeatBilling;
  web: StripeWebBilling | null;
};

type StripeSeatBilling = {
  configured: boolean;
  priceId: string | null;
  unitAmount: number;
  currency: string;
  interval: string;
  freeSeatCount: number;
  billableSeatCount: number;
  hasActiveSubscription: boolean;
  subscription: {
    status: string;
    quantity: number;
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
  } | null;
};

function parseStripeBilling(payload: unknown): StripeBilling | null {
  if (!payload || typeof payload !== "object" || !("billing" in payload)) return null;
  const billing = (payload as { billing?: unknown }).billing;
  if (!billing || typeof billing !== "object" || !("stripe" in billing)) return null;
  const stripe = (billing as { stripe?: unknown }).stripe;
  if (!stripe || typeof stripe !== "object") return null;
  const value = stripe as Partial<StripeBilling>;
  const seats = value.seats && typeof value.seats === "object" ? value.seats as Partial<StripeSeatBilling> : null;
  if (
    typeof value.unitAmount !== "number" ||
    typeof value.currency !== "string" ||
    typeof value.interval !== "string" ||
    typeof value.memberCount !== "number" ||
    typeof seats?.unitAmount !== "number" ||
    typeof seats.currency !== "string" ||
    typeof seats.interval !== "string" ||
    typeof seats.freeSeatCount !== "number" ||
    typeof seats.billableSeatCount !== "number"
  ) return null;
  return {
    configured: value.configured === true,
    priceId: typeof value.priceId === "string" ? value.priceId : null,
    unitAmount: value.unitAmount,
    currency: value.currency,
    interval: value.interval,
    memberCount: value.memberCount,
    hasActiveSubscription: value.hasActiveSubscription === true,
    portalUrl: typeof value.portalUrl === "string" ? value.portalUrl : null,
    subscription: value.subscription && typeof value.subscription === "object"
      ? {
          status: typeof value.subscription.status === "string" ? value.subscription.status : "unknown",
          quantity: typeof value.subscription.quantity === "number" ? value.subscription.quantity : 0,
          currentPeriodEnd: typeof value.subscription.currentPeriodEnd === "string" ? value.subscription.currentPeriodEnd : null,
          cancelAtPeriodEnd: value.subscription.cancelAtPeriodEnd === true,
        }
      : null,
    seats: {
      configured: seats?.configured === true,
      priceId: typeof seats?.priceId === "string" ? seats.priceId : null,
      unitAmount: seats.unitAmount,
      currency: seats.currency,
      interval: seats.interval,
      freeSeatCount: seats.freeSeatCount,
      billableSeatCount: seats.billableSeatCount,
      hasActiveSubscription: seats?.hasActiveSubscription === true,
      subscription: seats?.subscription && typeof seats.subscription === "object"
        ? {
            status: typeof seats.subscription.status === "string" ? seats.subscription.status : "unknown",
            quantity: typeof seats.subscription.quantity === "number" ? seats.subscription.quantity : 0,
            currentPeriodEnd: typeof seats.subscription.currentPeriodEnd === "string" ? seats.subscription.currentPeriodEnd : null,
            cancelAtPeriodEnd: seats.subscription.cancelAtPeriodEnd === true,
          }
        : null,
    },
    web: parseStripeWebBilling(payload),
  };
}

const STRIPE_RETURN_POLL_ATTEMPTS = 20;
const STRIPE_RETURN_POLL_INTERVAL_MS = 3000;

function formatBillingDate(value: string | null): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleDateString(DEFAULT_DEN_LOCALE, { day: "numeric", month: "short", year: "numeric" });
}

function BillingStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[16px] border border-gray-200 bg-white px-4 py-3.5">
      <p className="text-[13px] text-gray-500">{label}</p>
      <p className="mt-0.5 text-[20px] font-semibold tracking-[-0.02em] text-gray-950">{value}</p>
    </div>
  );
}

export function BillingDashboardScreen() {
  const router = useRouter();
  const { runtimeConfig, runtimeConfigLoaded, sessionHydrated, user } = useDenFlow();
  const { activeOrg, orgContext, runReauthableAction } = useOrgDashboard();
  const activeOrgId = orgContext?.organization.id ?? null;
  const [stripeBillingValue, setStripeBillingValue] = useState<StripeBilling | null>(null);
  const [stripeBillingOrgId, setStripeBillingOrgId] = useState<string | null>(null);
  const [stripeBusy, setStripeBusy] = useState(false);
  const [stripeActionBusy, setStripeActionBusy] = useState<"seat-checkout" | "portal" | null>(null);
  const [stripeError, setStripeError] = useState<string | null>(null);
  const [stripeReturnChecking, setStripeReturnChecking] = useState(false);
  const currentOrgIdRef = useRef(activeOrgId);
  const billingRequestIdRef = useRef(0);
  currentOrgIdRef.current = activeOrgId;
  const stripeBilling = stripeBillingOrgId === activeOrgId ? stripeBillingValue : null;

  const access = getOrgAccessFlags(
    orgContext?.currentMember.role ?? "member",
    orgContext?.currentMember.isOwner ?? false,
    orgContext?.currentMember.permissions,
  );
  const canManageBillingSettings = access.canManageBilling;
  const canOpenPortal = access.canOpenBillingPortal;
  const billingLockNotice = [
    canManageBillingSettings ? null : `无法开始订阅。${permissionLockReason("billing.manage")}`,
    canOpenPortal ? null : `无法管理付款详情、发票和取消订阅。${permissionLockReason("billing_portal.use")}`,
  ].filter((line): line is string => line !== null).join(" ");

  async function refreshStripeBilling(quiet = false) {
    const expectedOrgId = activeOrgId;
    if (!expectedOrgId) return null;
    const requestId = billingRequestIdRef.current + 1;
    billingRequestIdRef.current = requestId;
    setStripeBusy(true);
    if (!quiet) setStripeError(null);
    try {
      const { response, payload } = await requestJson(
        "/v1/billing",
        { method: "GET", headers: { [ORG_SCOPE_HEADER]: expectedOrgId } },
        12000,
      );
      if (!response.ok) throw new Error(getErrorMessage(payload, `无法查询账单（${response.status}）。`));
      const parsed = parseStripeBilling(payload);
      if (!parsed) throw new Error("账单响应不完整，请重试。");
      if (currentOrgIdRef.current !== expectedOrgId || billingRequestIdRef.current !== requestId) return null;
      setStripeBillingValue(parsed);
      setStripeBillingOrgId(expectedOrgId);
      return parsed;
    } catch (error) {
      if (!quiet && currentOrgIdRef.current === expectedOrgId && billingRequestIdRef.current === requestId) {
        setStripeError(error instanceof Error ? error.message : "无法加载账单详情，请重试。");
      }
      return null;
    } finally {
      if (currentOrgIdRef.current === expectedOrgId && billingRequestIdRef.current === requestId) setStripeBusy(false);
    }
  }

  useEffect(() => {
    if (!sessionHydrated || !user) return;
    void refreshStripeBilling(false);
  }, [sessionHydrated, user, activeOrgId]);

  useEffect(() => {
    if (!sessionHydrated || !user || typeof window === "undefined") return;

    const params = new URLSearchParams(window.location.search);
    if (params.get("stripe_checkout") !== "seat") return;
    const sessionId = params.get("session_id")?.trim() ?? "";

    let cancelled = false;
    let attempts = 0;
    setStripeReturnChecking(true);

    async function pollSeatSubscription() {
      attempts += 1;
      if (attempts === 1 && sessionId) {
        try {
          await runReauthableAction("stripe-checkout-sync", async () => {
            const { response, payload } = await requestJson(
              "/v1/billing/stripe/checkout/sync",
              { method: "POST", body: JSON.stringify({ sessionId }) },
              12000,
            );
            if (!response.ok) {
              setStripeError(getErrorMessage(payload, `结账状态同步失败（${response.status}）。`));
            }
          });
        } catch (error) {
          if (!cancelled) {
            setStripeError(error instanceof Error ? error.message : "无法同步结账会话，请重试。");
          }
        }
      }
      const billing = await refreshStripeBilling(true);
      if (cancelled) return;

      if (billing?.seats.hasActiveSubscription || attempts >= STRIPE_RETURN_POLL_ATTEMPTS) {
        setStripeReturnChecking(false);
        const url = new URL(window.location.href);
        url.searchParams.delete("stripe_checkout");
        url.searchParams.delete("session_id");
        window.history.replaceState(null, "", url.toString());
        return;
      }

      window.setTimeout(() => void pollSeatSubscription(), STRIPE_RETURN_POLL_INTERVAL_MS);
    }

    void pollSeatSubscription();

    return () => {
      cancelled = true;
    };
  }, [sessionHydrated, user, orgContext?.organization.id]);

  async function startSeatCheckout() {
    if (!canManageBillingSettings) {
      setStripeError(permissionLockReason("billing.manage"));
      return;
    }

    setStripeError(null);
    try {
      await runReauthableAction("seat-checkout", async () => {
        setStripeActionBusy("seat-checkout");
        const { response, payload } = await requestJson(
          "/v1/billing/stripe/checkout",
          { method: "POST", body: JSON.stringify({ type: "seat" }) },
          12000,
        );
        if (!response.ok) throw getRequestError(payload, response, `席位结账失败（${response.status}）。`);
        const url = payload && typeof payload === "object" && "url" in payload && typeof payload.url === "string" ? payload.url : null;
        if (!url) throw new Error("席位结账响应缺少地址，请重试。");
        window.location.href = url;
      });
    } catch (error) {
      setStripeError(error instanceof Error ? error.message : "无法开始席位结账，请重试。");
    } finally {
      setStripeActionBusy(null);
    }
  }

  async function openStripePortal() {
    if (!canOpenPortal) {
      setStripeError(permissionLockReason("billing_portal.use"));
      return;
    }

    setStripeError(null);
    try {
      await runReauthableAction("billing-portal", async () => {
        setStripeActionBusy("portal");
        const { response, payload } = await requestJson("/v1/billing/stripe/portal", { method: "POST" }, 12000);
        if (!response.ok) throw getRequestError(payload, response, `无法打开账单门户（${response.status}）。`);
        const url = payload && typeof payload === "object" && "url" in payload && typeof payload.url === "string" ? payload.url : null;
        if (!url) throw new Error("账单门户响应缺少地址，请重试。");
        window.location.href = url;
      });
    } catch (error) {
      setStripeError(error instanceof Error ? error.message : "无法打开账单门户，请重试。");
    } finally {
      setStripeActionBusy(null);
    }
  }

  const stripePrice = stripeBilling ? formatMoneyMinor(stripeBilling.unitAmount, stripeBilling.currency) : null;
  const seatBilling = stripeBilling?.seats;
  const webBilling = stripeBilling?.web ?? null;
  const seatPrice = seatBilling ? formatMoneyMinor(seatBilling.unitAmount, seatBilling.currency) : null;
  const activeMemberCount = stripeBilling?.memberCount ?? 0;

  // Without Stripe keys the deployment never charges for either product, so the
  // page must not quote prices or threaten future charges.
  const aiConfigured = stripeBilling?.configured === true;
  const seatsConfigured = seatBilling?.configured === true;
  const webFeatureEnabled = runtimeConfigLoaded
    && orgContext?.capabilities.openworkWeb === true;
  const webConfigured = webBilling?.configured === true;

  const aiActive = stripeBilling?.hasActiveSubscription === true;
  const aiStatus = stripeBilling?.subscription?.status ?? null;
  const aiPaymentFailed = aiStatus === "past_due" || aiStatus === "unpaid";
  const aiChargeMinor = stripeBilling ? stripeBilling.unitAmount * activeMemberCount : 0;
  const aiChargeLabel = stripeBilling ? formatMoneyMinor(aiChargeMinor, stripeBilling.currency) : null;
  const aiRenewsOn = formatBillingDate(stripeBilling?.subscription?.currentPeriodEnd ?? null);
  const aiCancelling = stripeBilling?.subscription?.cancelAtPeriodEnd === true;

  const seatsActive = seatBilling?.hasActiveSubscription === true;
  const freeSeatCount = seatBilling?.freeSeatCount ?? 0;
  const billableSeatCount = seatBilling?.billableSeatCount ?? 0;
  const seatChargeMinor = seatBilling ? seatBilling.unitAmount * billableSeatCount : 0;
  const seatChargeLabel = seatBilling ? formatMoneyMinor(seatChargeMinor, seatBilling.currency) : null;
  const freeSeatsLeft = Math.max(0, freeSeatCount - activeMemberCount);

  const webSubscription = webBilling?.subscription ?? null;
  const webSubscribed = Boolean(webSubscription);
  const webEligible = webBilling?.hasAccess === true;
  const webAccessSource = webBilling?.accessSource ?? null;
  const webComplimentary = webAccessSource === "complimentary";
  const webPrice = webBilling ? formatMoneyMinor(webBilling.unitAmount, webBilling.currency) : null;
  const webChargeMinor = webBilling?.expectedMonthlyTotal ?? 0;
  const webChargeLabel = webBilling ? formatMoneyMinor(webChargeMinor, webBilling.currency) : null;
  const webStatus = webSubscription?.status ?? null;
  const webCountsTowardTotal = !webComplimentary && webSubscribed && webStatus !== "canceled" && webStatus !== "expired" && webStatus !== "incomplete_expired";
  const webPaymentStatus = webSubscription?.paymentStatus ?? null;
  const webPaymentFailed = webPaymentStatus === "past_due" || webPaymentStatus === "unpaid" || webPaymentStatus === "payment_failed";
  const webRenewsOn = formatBillingDate(webSubscription?.currentPeriodEnd ?? null);
  const webCancelling = webSubscription?.cancelAtPeriodEnd === true;
  const webQuantityCurrent = webSubscription ? webSubscription.quantity === webBilling?.quantity : true;

  const totalMinor = (aiActive ? aiChargeMinor : 0) + (seatsActive ? seatChargeMinor : 0) + (webFeatureEnabled && webCountsTowardTotal ? webChargeMinor : 0);
  const totalLabel = stripeBilling ? formatMoneyMinor(totalMinor, stripeBilling.currency) : null;

  const membersRoute = getMembersRoute(activeOrg?.slug);
  const goToMembers = () => {
    window.location.href = membersRoute;
  };

  return (
    <div data-testid="stripe-billing-screen">
      <DashboardPageTemplate
        icon={CreditCard}
        title="账单"
        description={webFeatureEnabled
          ? webComplimentary
            ? "此组织可免费使用 OpenWork Web。团队席位与内置 AI 模型访问权限仍需分别购买。"
            : "OpenWork Web、团队席位与内置 AI 模型访问权限分别购买。预计每月总额包含下方显示的订阅。"
          : "团队席位与内置 AI 模型访问权限分别购买。预计每月总额包含下方显示的订阅。"}
      >
      {stripeError && stripeBilling ? (
        <DenNotice message={stripeError} className="mb-6" />
      ) : null}

      {billingLockNotice ? (
        <DenNotice tone="neutral" className="mb-6" message={billingLockNotice} />
      ) : null}

      {stripeReturnChecking ? (
        <DenNotice
          tone="info"
          className="mb-6"
          message="正在检查订阅，此页面会自动刷新。"
        />
      ) : null}

      {!stripeBilling ? (
        <DenCard size="spacious">
          {stripeBusy ? (
            <div className="flex min-h-36 items-center justify-center gap-3 text-[14px] text-gray-500">
              <RefreshCw className="size-4 animate-spin text-[#635BFF]" aria-hidden="true" />
              正在加载账单详情…
            </div>
          ) : (
            <div className="mx-auto grid max-w-lg justify-items-start gap-3">
              <p className="text-[16px] font-medium text-gray-950">无法加载账单详情</p>
              <p className="text-[13px] leading-6 text-gray-500">{stripeError ?? "账单响应缺少本页所需的详情，请重试。"}</p>
              <DenButton icon={RefreshCw} onClick={() => void refreshStripeBilling(false)}>重试</DenButton>
            </div>
          )}
        </DenCard>
      ) : (
        <>
      <DenCard className="mb-6 !p-0" data-testid="billing-summary-card">
        <DenSectionHeader
          className="p-6 pb-4"
          title="你的订阅"
          description={webFeatureEnabled
            ? webComplimentary
              ? "已包含 OpenWork Web，无需 Stripe 订阅或按成员付费。"
              : "各套餐分别计费。OpenWork Web 按已加入组织的成员计费，每人每月 50 美元。"
            : "各套餐分别计费。"}
          action={
            <DenButton variant="secondary" size="sm" icon={RefreshCw} loading={stripeBusy} onClick={() => void refreshStripeBilling(false)}>
              刷新
            </DenButton>
          }
        />
        <div className="border-t border-gray-200">
          <DenLineItemRow
            className="mx-4 rounded-[18px]"
            leading={
              <DenMarkTile
                label={seatsConfigured ? `${activeMemberCount}/${freeSeatCount}` : String(activeMemberCount)}
                active={seatsActive && billableSeatCount > 0}
              />
            }
            title="团队席位"
            description={
              !seatsConfigured
                ? `${activeMemberCount} 名活跃用户 · 此部署不收取席位费用`
                : billableSeatCount > 0
                  ? `超过 ${freeSeatCount} 个免费席位的 ${billableSeatCount} 名付费用户`
                  : `已使用 ${activeMemberCount} / ${freeSeatCount} 个免费用户席位 · 暂无费用`
            }
            value={seatsActive ? seatChargeLabel ?? "" : formatMoneyMinor(0, seatBilling?.currency ?? "usd")}
            valueCaption={`/ ${denBillingIntervalLabel(seatBilling?.interval ?? "month")}`}
            badge={
              !seatsConfigured
                ? <DenBadge tone="neutral">未计费</DenBadge>
                : seatsActive
                  ? <DenBadge tone="success" icon={Check}>已启用</DenBadge>
                  : <DenBadge tone="neutral">已包含</DenBadge>
            }
          />
          {webFeatureEnabled ? (
            <DenLineItemRow
              className="mx-4 rounded-[18px]"
              leading={<DenMarkTile label={webBilling ? `${webBilling.quantity}x` : "—"} active={webEligible} />}
              title="OpenWork Web"
              description={
                !webBilling
                  ? "账单详情不可用 · 浏览器访问权限仍锁定"
                  : webComplimentary
                    ? `已覆盖${getOpenWorkWebQuantityDescription(webBilling.quantity)} · 免费使用权限`
                  : !webConfigured
                    ? "此部署不销售 OpenWork Web 访问权限"
                    : webSubscribed
                      ? `${getOpenWorkWebQuantityDescription(webBilling.quantity)} × ${webPrice} · ${formatSubscriptionStatus(webStatus ?? "unknown")}`
                      : `${getOpenWorkWebQuantityDescription(webBilling.quantity)} · 尚未订阅`
              }
              value={webComplimentary ? formatMoneyMinor(0, webBilling?.currency ?? "usd") : webCountsTowardTotal ? webChargeLabel ?? "" : formatMoneyMinor(0, webBilling?.currency ?? "usd")}
              valueCaption={webComplimentary ? "免费" : `/ ${denBillingIntervalLabel(webBilling?.interval ?? "month")}`}
              badge={
                webComplimentary
                  ? <DenBadge tone="success" icon={Check}>免费赠送</DenBadge>
                  : !webBilling || !webConfigured
                  ? <DenBadge tone="neutral">未计费</DenBadge>
                  : webPaymentFailed
                    ? <DenBadge tone="warning">支付失败</DenBadge>
                    : webCancelling
                      ? <DenBadge tone="warning">正在取消</DenBadge>
                      : webEligible
                        ? <DenBadge tone="success" icon={Check}>已启用</DenBadge>
                        : webSubscribed
                          ? <DenBadge tone="warning">访问权限已锁定</DenBadge>
                          : <DenBadge tone="neutral">关闭</DenBadge>
              }
            />
          ) : null}
          <DenLineItemRow
            className="mx-4 rounded-[18px]"
            leading={<DenMarkTile label={`${activeMemberCount}x`} active={aiActive} />}
            title="AI 模型访问权限"
            description={
              !aiConfigured
                ? "此部署不销售模型访问权限 · 团队使用自有 API 密钥"
                : aiActive
                  ? `${activeMemberCount} 名活跃成员 × ${stripePrice} · 按每位成员计费`
                  : "未订阅 · 团队使用自有 API 密钥"
            }
            value={aiActive ? aiChargeLabel ?? "" : formatMoneyMinor(0, stripeBilling.currency)}
            valueCaption={`/ ${denBillingIntervalLabel(stripeBilling.interval)}`}
            badge={
              !aiConfigured
                ? <DenBadge tone="neutral">未计费</DenBadge>
                : aiPaymentFailed
                  ? <DenBadge tone="warning">支付失败</DenBadge>
                  : aiActive
                    ? <DenBadge tone="success" icon={Check}>已启用</DenBadge>
                    : <DenBadge tone="neutral">关闭</DenBadge>
            }
          />
          <DenLineItemRow
            className="mt-1 border-t border-gray-200"
            emphasis
            title="预计每月总额"
            value={totalLabel ?? ""}
            valueCaption={`/ ${denBillingIntervalLabel(stripeBilling.interval)}`}
          />
        </div>
      </DenCard>

      {webFeatureEnabled ? (
        <DenCard className="mb-6" data-testid="billing-openwork-web-card">
          <DenSectionHeader
            title="OpenWork Web"
            description={webComplimentary
              ? "所有已加入组织的成员均可免费使用浏览器访问权限。"
              : "组织浏览器访问权限，按已加入成员计费，每人每月 50 美元。"}
            action={
              webComplimentary
                ? <DenBadge tone="success" icon={Check}>免费赠送</DenBadge>
                : !webBilling || !webConfigured
                ? <DenBadge tone="neutral">未计费</DenBadge>
                : webPaymentFailed
                  ? <DenBadge tone="warning">支付失败</DenBadge>
                  : webCancelling
                    ? <DenBadge tone="warning">正在取消</DenBadge>
                    : webEligible
                      ? <DenBadge tone="success" icon={Check}>已启用</DenBadge>
                      : webSubscribed
                        ? <DenBadge tone="warning">访问权限已锁定</DenBadge>
                        : <DenBadge tone="neutral">关闭</DenBadge>
            }
          />

          {!webBilling ? (
            <DenNotice
              className="mt-5"
              message="OpenWork Web 账单详情不可用，确认订阅前浏览器访问权限将保持锁定。"
            />
          ) : (
            <>
              <DenNotice
                className="mt-5"
                tone={webComplimentary ? "info" : !webConfigured ? "neutral" : webPaymentFailed ? "error" : webEligible ? "info" : "warning"}
                message={
                  webComplimentary
                    ? "此组织已包含 OpenWork Web，无需 Stripe 订阅或按成员付费。"
                    : !webConfigured
                    ? "此部署尚未配置 OpenWork Web 计费。"
                    : webPaymentFailed
                      ? webPaymentStatus === "payment_failed"
                        ? "最近一次付款失败，OpenWork Web 已锁定。请更新付款方式以恢复访问。"
                        : `付款状态为${formatSubscriptionStatus(webPaymentStatus ?? "failed").toLowerCase()}，OpenWork Web 已暂停。请更新付款方式以恢复访问。`
                      : webCancelling
                        ? `已安排取消订阅，使用权限保留至${webRenewsOn ?? "当前计费周期结束时"}，此前可随时恢复订阅。`
                        : webEligible
                          ? "此组织的 OpenWork Web 已生效。"
                          : webSubscribed
                            ? `订阅状态为${formatSubscriptionStatus(webStatus ?? "unknown").toLowerCase()}，OpenWork Web 已暂停。`
                            : "没有生效的 OpenWork Web 订阅，可从 OpenWork Web 页面购买。"
                }
              />

              <p className="mt-5 text-[14px] leading-6 text-gray-600" data-testid="billing-openwork-web-quantity-definition">
                {webComplimentary
                  ? "包含组织所有已加入的成员及所有者，待接受的邀请在加入后才计入。"
                  : OPENWORK_WEB_QUANTITY_EXPLANATION}
              </p>
              <div className="mt-4 rounded-2xl border border-gray-200 bg-gray-50 p-4" data-testid="billing-openwork-web-price-breakdown">
                <p className="text-[22px] font-semibold tracking-[-0.03em] text-gray-950">
                  {webComplimentary
                    ? `已覆盖${getOpenWorkWebQuantityDescription(webBilling.quantity)}`
                    : `${getOpenWorkWebQuantityDescription(webBilling.quantity)} × ${webPrice}`}
                </p>
                <p className="mt-1 text-[14px] text-gray-600">
                  {webComplimentary ? "每月费用 0.00 美元" : `${webChargeLabel} / ${denBillingIntervalLabel(webBilling.interval)}`}
                </p>
              </div>

              <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <BillingStat label="套餐" value="OpenWork Web" />
                <BillingStat label={webComplimentary ? "访问权限" : "单价"} value={webComplimentary ? "免费赠送" : `${webPrice ?? "—"} / 人 / 月`} />
                <BillingStat label={webComplimentary ? "已覆盖成员" : "计费成员"} value={String(webBilling.quantity)} />
                <BillingStat label="预计每月总额" value={webComplimentary ? "$0.00" : webChargeLabel ?? "—"} />
              </div>

              {!webComplimentary ? (
                <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3" data-testid="billing-openwork-web-lifecycle">
                  <BillingStat label="订阅状态" value={webStatus ? formatSubscriptionStatus(webStatus) : "未订阅"} />
                  <BillingStat label="付款状态" value={webPaymentStatus ? formatSubscriptionStatus(webPaymentStatus) : "不可用"} />
                  <BillingStat
                    label={webCancelling ? "访问权限结束时间" : "下次续费"}
                    value={webRenewsOn ?? "不可用"}
                  />
                </div>
              ) : null}

              {!webComplimentary && !webQuantityCurrent ? (
                <DenNotice
                  className="mt-5"
                  tone="info"
                  message={`组织现有 ${webBilling.quantity} 名成员，账单将很快同步更新。`}
                />
              ) : null}

              <DenActionList className="mt-5">
                <DenActionRow
                  description={webComplimentary
                    ? "所有已加入成员均被覆盖，无需按人付费。管理成员不会更改此授权。"
                    : "添加或移除成员以调整组织费用，待接受的邀请不计费。"}
                  action={<DenButton variant="secondary" onClick={goToMembers}>管理成员</DenButton>}
                />
                {webComplimentary ? null : webSubscribed ? (
                  <DenActionRow
                    description={
                      webCancelling
                        ? "打开 Stripe，以在访问权限结束前重新激活、更新付款信息或查看发票。"
                        : "打开 Stripe 以更新付款信息、查看发票、更改或取消订阅。"
                    }
                    action={
                      <DenButton
                        variant={webPaymentFailed ? "primary" : "secondary"}
                        disabled={!canOpenPortal}
                        loading={stripeActionBusy === "portal"}
                        onClick={openStripePortal}
                      >
                        {webPaymentFailed ? "更新付款方式" : "管理或取消"}
                      </DenButton>
                    }
                  />
                ) : (
                  <DenActionRow
                    description={`在 OpenWork Web 页面购买，价格为${getOpenWorkWebQuantityDescription(webBilling.quantity)} × ${webPrice} / ${denBillingIntervalLabel(webBilling.interval)}。`}
                    action={<DenButton onClick={() => router.push(getWebRoute(activeOrg?.slug))}>查看 OpenWork Web</DenButton>}
                  />
                )}
              </DenActionList>
            </>
          )}
        </DenCard>
      ) : null}

      <DenCard className="mb-6" data-testid="billing-seats-card">
        <DenSectionHeader
          title="团队席位"
          description={
            seatsConfigured
              ? `可邀请超过 ${freeSeatCount} 人。前 ${freeSeatCount} 名用户免费，额外用户每人 ${seatPrice} / ${denBillingIntervalLabel(seatBilling?.interval ?? "month")}。`
              : "所有受邀成员都可使用此工作区。"
          }
          action={
            !seatsConfigured
              ? <DenBadge tone="neutral">未计费</DenBadge>
              : seatsActive
                ? <DenBadge tone="success" icon={Check}>已启用</DenBadge>
                : <DenBadge tone="neutral">已包含</DenBadge>
          }
        />

        <DenNotice
          tone="neutral"
          className="mt-5"
          message={
            seatsConfigured
              ? "不包含 AI 模型访问权限，该权限在下方单独订阅。"
              : "此部署未配置席位计费，因此不限制成员数量，也不收取席位费用。AI 模型访问权限在下方单独管理。"
          }
        />

        {seatsConfigured ? (
          <DenUsageMeter
            className="mt-5"
            label={billableSeatCount > 0 ? `${activeMemberCount} 名用户 · ${freeSeatCount} 名免费，${billableSeatCount} 名付费` : "已用免费席位"}
            used={activeMemberCount}
            total={freeSeatCount}
            caption={
              billableSeatCount > 0
                ? `超过 ${freeSeatCount} 个免费席位的 ${billableSeatCount} 名用户费用为 ${seatChargeLabel} / ${denBillingIntervalLabel(seatBilling?.interval ?? "month")}。`
                : freeSeatsLeft > 0
                  ? `开始计费前还可使用 ${freeSeatsLeft} 个免费席位。`
                  : `免费席位已满，下一次邀请将产生 ${seatPrice} / ${denBillingIntervalLabel(seatBilling?.interval ?? "month")} 的费用。`
            }
          />
        ) : null}

        <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <BillingStat label="活跃用户" value={String(activeMemberCount)} />
          <BillingStat label="席位费用" value={seatsConfigured ? seatChargeLabel ?? "" : formatMoneyMinor(0, seatBilling?.currency ?? "usd")} />
        </div>

        <DenActionList className="mt-5">
          <DenActionRow
            description={
              seatsConfigured
                ? "邀请、移除成员或更改角色。移除成员会释放席位并降低 AI 费用。"
                : "邀请、移除成员或更改角色。此部署不限制成员数量。"
            }
            action={<DenButton variant="secondary" onClick={goToMembers}>管理成员</DenButton>}
          />
          {!seatsConfigured ? null : seatsActive ? (
            <DenActionRow
              description={`打开 Stripe 以更换银行卡、下载发票或取消席位计费，${freeSeatCount} 个免费席位始终保留。`}
              action={
                <DenButton variant="secondary" disabled={!canOpenPortal} loading={stripeActionBusy === "portal"} onClick={openStripePortal}>
                  管理订阅
                </DenButton>
              }
            />
          ) : (
            <DenActionRow
              description={`仅在超过 ${freeSeatCount} 名用户时需要。现在保存银行卡，之后每位额外用户按 ${seatPrice} / ${denBillingIntervalLabel(seatBilling?.interval ?? "month")} 收费。`}
              action={
                <DenButton
                 
                  disabled={!canManageBillingSettings || seatBilling?.configured === false}
                  loading={stripeActionBusy === "seat-checkout"}
                  onClick={startSeatCheckout}
                >
                  添加付费席位
                </DenButton>
              }
            />
          )}
        </DenActionList>
      </DenCard>

      <DenCard data-testid="billing-ai-card">
        <DenSectionHeader
          title="AI 模型访问权限"
          description="使用 OpenWork 内置模型，无需管理 API 密钥。与席位分别计费。"
          action={
            !aiConfigured
              ? <DenBadge tone="neutral">未计费</DenBadge>
              : aiPaymentFailed
                ? <DenBadge tone="warning">支付失败</DenBadge>
                : aiActive
                  ? <DenBadge tone="success" icon={Check}>已启用</DenBadge>
                  : <DenBadge tone="neutral">关闭</DenBadge>
          }
        />

        <DenNotice
          tone={!aiConfigured ? "neutral" : aiPaymentFailed ? "error" : "warning"}
          className="mt-5"
          message={
            !aiConfigured
              ? "此部署未配置模型计费，不收取 AI 访问费用。团队使用自有提供商密钥连接。"
              : aiPaymentFailed
                ? `上次付款失败，所有人的模型访问将暂停至付款完成。席位和团队访问权限不受影响。${aiStatus ? `Stripe 报告的订阅状态为${formatSubscriptionStatus(aiStatus).toLowerCase()}。` : ""}`
                : `按每位活跃成员计费${seatsConfigured ? `，包括 ${freeSeatCount} 个免费席位` : ""}，每邀请一人，账单增加 ${stripePrice} / ${denBillingIntervalLabel(stripeBilling.interval)}。`
          }
        />

        {aiConfigured ? (
          <div className="mt-5 flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="text-[13px] text-gray-500">
              {activeMemberCount} 名活跃成员 × {stripePrice} =
            </span>
            <span className="text-[22px] font-semibold tracking-[-0.03em] text-gray-950">{aiChargeLabel}</span>
            <span className="text-[13px] text-gray-500">
              / {stripeBilling.interval === "year" ? "年" : "月"}
              {aiActive && aiRenewsOn ? (aiCancelling ? ` · 使用权限结束于 ${aiRenewsOn}` : ` · 续订于 ${aiRenewsOn}`) : ""}
            </span>
          </div>
        ) : null}

        <DenActionList className="mt-5">
          {aiActive ? (
            <DenActionRow
              description={
                aiCancelling
                  ? `已安排取消订阅，使用权限保留至${aiRenewsOn ?? "当前周期结束时"}，此前可在 Stripe 中恢复订阅。`
                  : "打开 Stripe 以更换银行卡、下载发票或取消订阅。访问权限将保留至已支付的周期结束。"
              }
              action={
                <DenButton
                  variant={aiPaymentFailed ? "primary" : "secondary"}
                 
                  disabled={!canOpenPortal}
                  loading={stripeActionBusy === "portal"}
                  onClick={openStripePortal}
                >
                  {aiPaymentFailed ? "更新付款方式" : "管理订阅"}
                </DenButton>
              }
            />
          ) : (
            <DenActionRow
              description={
                aiConfigured
                  ? `为 ${activeMemberCount} 名用户开启此功能的费用为 ${aiChargeLabel} / ${denBillingIntervalLabel(stripeBilling.interval)}，而非 ${stripePrice}。请在 OpenWork 模型页面订阅。`
                  : "查看 OpenWork 内置的模型，以及团队如何连接自有提供商密钥。"
              }
              action={
                <DenButton onClick={() => router.push(getInferenceRoute(activeOrg?.slug))}>
                  查看 OpenWork 模型
                </DenButton>
              }
            />
          )}
          {aiActive ? (
            <DenActionRow
              description="移除不再协作的成员可降低费用，模型访问权限必须为整个团队购买。"
              action={<DenButton variant="secondary" onClick={goToMembers}>管理成员</DenButton>}
            />
          ) : null}
        </DenActionList>
      </DenCard>
        </>
      )}
      </DashboardPageTemplate>
    </div>
  );
}
