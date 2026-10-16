"use client";

import { useEffect, useRef, useState } from "react";
import { ExternalLink, Globe, Loader2, RefreshCw } from "lucide-react";
import { notFound } from "next/navigation";

import { useDenFlow } from "../../_providers/den-flow-provider";
import { DenButton } from "../../_components/ui/button";
import { DenCard } from "../../_components/ui/card";
import { DashboardPageTemplate } from "../../_components/ui/dashboard-page-template";
import { DenNotice } from "../../_components/ui/notice";
import { formatMoneyMinor, formatSubscriptionStatus, getErrorMessage, getRequestError, requestJson } from "../../_lib/den-flow";
import { getBillingRoute, getOrgAccessFlags } from "../../_lib/den-org";
import { ORG_SCOPE_HEADER } from "../../_lib/org-scope";
import {
  getOpenWorkWebQuantityDescription,
  OPENWORK_WEB_CHECKOUT_TYPE,
  OPENWORK_WEB_QUANTITY_EXPLANATION,
  parseStripeWebBilling,
  type StripeWebBilling,
} from "../_lib/stripe-web-billing";
import { useOrgDashboard } from "../_providers/org-dashboard-provider";

export type WebPageAccessState = "loading" | "not-found" | "error" | "unsubscribed" | "confirming" | "eligible";

export function hasOngoingWebSubscription(billing: StripeWebBilling): boolean {
  return Boolean(
    billing.subscription &&
    billing.subscription.status !== "canceled" &&
    billing.subscription.status !== "expired" &&
    billing.subscription.status !== "incomplete_expired",
  );
}

export function isExistingWebAccessResponse(response: Response, payload: unknown): boolean {
  return response.status === 409
    && Boolean(
      payload
      && typeof payload === "object"
      && "error" in payload
      && (payload.error === "stripe_subscription_exists" || payload.error === "openwork_web_complimentary_access_exists"),
    );
}

export function getWebPageAccessState({
  orgBusy,
  hasOrgContext,
  activeOrgId,
  webAvailable,
  runtimeConfigLoaded,
  billingOrgId,
  billing,
  billingError,
  confirming,
}: {
  orgBusy: boolean;
  hasOrgContext: boolean;
  activeOrgId: string | null;
  webAvailable: boolean;
  runtimeConfigLoaded: boolean;
  billingOrgId: string | null;
  billing: StripeWebBilling | null;
  billingError: string | null;
  confirming: boolean;
}): WebPageAccessState {
  if (orgBusy || !hasOrgContext || !activeOrgId || !runtimeConfigLoaded) return "loading";
  if (!webAvailable) return "not-found";
  if (billingError) return "error";
  if (billingOrgId !== activeOrgId || !billing) return "loading";
  if (confirming) return "confirming";
  return billing.hasAccess ? "eligible" : "unsubscribed";
}

function CheckingWorkspaceAccess({ message = "正在检查工作区访问权限" }: { message?: string }) {
  return (
    <div className="flex min-h-[420px] items-center justify-center px-6" data-testid="web-access-state" data-access-state="loading">
      <div className="w-full max-w-sm rounded-2xl border border-gray-200 bg-white p-6 shadow-[0_12px_40px_-28px_rgba(15,23,42,0.35)]">
        <div className="flex items-start gap-4">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-gray-100 text-gray-600">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          </div>
          <div>
            <p className="text-[15px] font-medium text-gray-950">{message}</p>
            <p className="mt-1 text-[13px] leading-5 text-gray-500">正在加载组织订阅。</p>
          </div>
        </div>
      </div>
    </div>
  );
}

export function WebOpenButton({ openworkWebUrl }: { openworkWebUrl: string }) {
  return (
    <DenButton href={openworkWebUrl} target="_blank" rel="noopener noreferrer" icon={ExternalLink}>
      打开 OpenWork Web
    </DenButton>
  );
}

export function WebPurchaseButton({ disabled, loading, onClick }: { disabled: boolean; loading: boolean; onClick: () => void }) {
  return (
    <DenButton disabled={disabled} loading={loading} onClick={onClick}>
      购买 OpenWork Web，每名成员每月 50 美元
    </DenButton>
  );
}

const STRIPE_RETURN_POLL_ATTEMPTS = 20;
const STRIPE_RETURN_POLL_INTERVAL_MS = 3000;

function clearStripeReturnParameters() {
  const url = new URL(window.location.href);
  url.searchParams.delete("stripe_checkout");
  url.searchParams.delete("session_id");
  url.searchParams.delete("canceled");
  window.history.replaceState(null, "", url.toString());
}

export default function WebPage() {
  const { orgContext, orgBusy, activeOrg, runReauthableAction } = useOrgDashboard();
  const { runtimeConfig, runtimeConfigLoaded } = useDenFlow();
  const orgId = orgContext?.organization.id ?? null;
  const webAvailable = runtimeConfigLoaded
    && orgContext?.capabilities.openworkWeb === true;
  const [billingRecord, setBillingRecord] = useState<{ orgId: string; billing: StripeWebBilling } | null>(null);
  const [errorRecord, setErrorRecord] = useState<{ orgId: string; message: string } | null>(null);
  const [checkoutBusy, setCheckoutBusy] = useState(false);
  const [returnChecking, setReturnChecking] = useState(false);
  const currentOrgIdRef = useRef(orgId);
  const checkoutStartingRef = useRef(false);
  const syncedSessionsRef = useRef(new Map<string, Promise<boolean>>());
  const mountedRef = useRef(true);
  currentOrgIdRef.current = orgId;

  const billing = billingRecord?.orgId === orgId ? billingRecord.billing : null;
  const billingError = errorRecord?.orgId === orgId ? errorRecord.message : null;
  const access = getOrgAccessFlags(
    orgContext?.currentMember.role ?? "member",
    orgContext?.currentMember.isOwner ?? false,
    orgContext?.currentMember.permissions,
  );
  // Checkout and checkout sync need `billing.manage`.
  const canPurchaseWeb = access.canManageBilling;

  async function requestWebBilling(expectedOrgId: string, quiet: boolean): Promise<StripeWebBilling | null> {
    if (!quiet && currentOrgIdRef.current === expectedOrgId) {
      setErrorRecord(null);
      setBillingRecord((current) => current?.orgId === expectedOrgId ? null : current);
    }
    try {
      const { response, payload } = await requestJson(
        "/v1/billing/web",
        { method: "GET", headers: { [ORG_SCOPE_HEADER]: expectedOrgId } },
        12000,
      );
      if (!response.ok) throw new Error(getErrorMessage(payload, `无法查询 OpenWork Web 账单（${response.status}）。`));
      const parsed = parseStripeWebBilling(payload);
      if (!parsed) throw new Error("OpenWork Web 账单响应不完整，请重试。");
      if (!mountedRef.current || currentOrgIdRef.current !== expectedOrgId) return null;
      setBillingRecord({ orgId: expectedOrgId, billing: parsed });
      setErrorRecord(null);
      return parsed;
    } catch (error) {
      if (!quiet && mountedRef.current && currentOrgIdRef.current === expectedOrgId) {
        setErrorRecord({
          orgId: expectedOrgId,
          message: error instanceof Error ? error.message : "无法加载 OpenWork Web 账单，请重试。",
        });
      }
      return null;
    }
  }

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!orgId || orgBusy || !webAvailable) return;
    setReturnChecking(false);
    setErrorRecord(null);
    void requestWebBilling(orgId, false);
  }, [orgId, orgBusy, webAvailable]);

  useEffect(() => {
    if (!orgId || orgBusy || !webAvailable || typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("stripe_checkout") !== OPENWORK_WEB_CHECKOUT_TYPE) return;

    const sessionId = params.get("session_id")?.trim() ?? "";
    if (!sessionId) {
      setReturnChecking(false);
      setErrorRecord({
        orgId,
        message: "结账已取消，未产生付款，可在准备好后购买。",
      });
      clearStripeReturnParameters();
      return;
    }

    let stopped = false;
    let timer: number | null = null;
    let attempts = 0;
    const expectedOrgId = orgId;
    const syncKey = `${expectedOrgId}:${sessionId}`;
    setReturnChecking(true);
    setErrorRecord(null);

    async function confirmSubscription() {
      try {
        let syncPromise = syncedSessionsRef.current.get(syncKey);
        if (!syncPromise) {
          syncPromise = (async () => {
            let synced: boolean = false;
            await runReauthableAction("openwork-web-checkout-sync", async () => {
              const { response, payload } = await requestJson(
                "/v1/billing/stripe/checkout/sync",
                {
                  method: "POST",
                  headers: { [ORG_SCOPE_HEADER]: expectedOrgId },
                  body: JSON.stringify({ sessionId, type: OPENWORK_WEB_CHECKOUT_TYPE }),
                },
                12000,
              );
              if (!response.ok) throw getRequestError(payload, response, `无法确认结账结果（${response.status}）。`);
              synced = Boolean(payload && typeof payload === "object" && "synced" in payload && payload.synced === true);
            });
            return synced;
          })();
          syncedSessionsRef.current.set(syncKey, syncPromise);
        }
        const synced = await syncPromise;
        if (!synced) throw new Error("无法为当前组织确认此次结账。若已完成付款，访问权限将很快开启。");
      } catch (error) {
        if (!stopped && mountedRef.current && currentOrgIdRef.current === expectedOrgId) {
          setReturnChecking(false);
          setErrorRecord({
            orgId: expectedOrgId,
            message: error instanceof Error ? error.message : "无法确认此次结账，OpenWork Web 仍保持锁定。",
          });
          clearStripeReturnParameters();
        }
        return;
      }

      async function pollEligibility() {
        attempts += 1;
        const nextBilling = await requestWebBilling(expectedOrgId, true);
        if (stopped || !mountedRef.current || currentOrgIdRef.current !== expectedOrgId) return;
        if (nextBilling?.hasAccess) {
          setReturnChecking(false);
          setErrorRecord(null);
          clearStripeReturnParameters();
          return;
        }
        if (attempts >= STRIPE_RETURN_POLL_ATTEMPTS) {
          setReturnChecking(false);
          setErrorRecord({
            orgId: expectedOrgId,
            message: "付款仍在确认，确认完成后访问权限会自动开启，请稍后查看。",
          });
          clearStripeReturnParameters();
          return;
        }
        timer = window.setTimeout(() => void pollEligibility(), STRIPE_RETURN_POLL_INTERVAL_MS);
      }

      await pollEligibility();
    }

    void confirmSubscription();
    return () => {
      stopped = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [orgId, orgBusy, webAvailable]);

  async function startWebCheckout() {
    if (!orgId || checkoutStartingRef.current) return;
    if (!canPurchaseWeb) {
      setErrorRecord({ orgId, message: "购买 OpenWork Web 需要“管理账单”权限，请联系组织所有者或管理员。" });
      return;
    }
    if (!billing?.configured) {
      setErrorRecord({ orgId, message: "此部署尚未配置 OpenWork Web 计费。" });
      return;
    }
    if (billing.hasAccess || hasOngoingWebSubscription(billing)) return;

    checkoutStartingRef.current = true;
    setCheckoutBusy(true);
    setErrorRecord(null);
    try {
      await runReauthableAction("openwork-web-checkout", async () => {
        const { response, payload } = await requestJson(
          "/v1/billing/stripe/checkout",
          {
            method: "POST",
            headers: { [ORG_SCOPE_HEADER]: orgId },
            body: JSON.stringify({ type: OPENWORK_WEB_CHECKOUT_TYPE }),
          },
          12000,
        );
        if (isExistingWebAccessResponse(response, payload)) {
          await requestWebBilling(orgId, false);
          return;
        }
        if (!response.ok) throw getRequestError(payload, response, `OpenWork Web 结账失败（${response.status}）。`);
        const url = payload && typeof payload === "object" && "url" in payload && typeof payload.url === "string" ? payload.url : null;
        if (!url) throw new Error("OpenWork Web 结账响应中缺少地址，请重试。");
        if (!mountedRef.current || currentOrgIdRef.current !== orgId) {
          throw new Error("打开结账页面前，当前组织已更改，请重试。");
        }
        window.location.href = url;
      });
    } catch (error) {
      if (mountedRef.current && currentOrgIdRef.current === orgId) {
        setErrorRecord({ orgId, message: error instanceof Error ? error.message : "无法开始 OpenWork Web 结账，请重试。" });
      }
    } finally {
      checkoutStartingRef.current = false;
      if (mountedRef.current) setCheckoutBusy(false);
    }
  }

  async function retryBilling() {
    if (!orgId) return;
    setReturnChecking(false);
    setErrorRecord(null);
    await requestWebBilling(orgId, false);
  }

  const accessState = getWebPageAccessState({
    orgBusy,
    hasOrgContext: Boolean(orgContext),
    activeOrgId: orgId,
    webAvailable,
    runtimeConfigLoaded,
    billingOrgId: billingRecord?.orgId ?? null,
    billing,
    billingError,
    confirming: returnChecking,
  });

  if (accessState === "loading") return <CheckingWorkspaceAccess />;
  if (accessState === "not-found") notFound();

  const unitPrice = billing ? formatMoneyMinor(billing.unitAmount, billing.currency) : "$50.00";
  const expectedTotal = billing ? formatMoneyMinor(billing.expectedMonthlyTotal, billing.currency) : null;
  const hasOngoingSubscription = billing ? hasOngoingWebSubscription(billing) : false;

  return (
    <DashboardPageTemplate
      icon={Globe}
      title="OpenWork Web"
      description="通过组织订阅在浏览器中使用 OpenWork。"
    >
      <div data-testid="openwork-web-access" data-access-state={accessState} data-access-source={billing?.accessSource ?? "none"}>
        {accessState === "error" ? (
          <DenCard size="spacious" data-testid="openwork-web-error">
            <p className="text-[18px] font-medium text-gray-950">OpenWork Web 仍处于锁定状态</p>
            <DenNotice className="mt-4" message={billingError ?? "无法确认账单，请重试。"} />
            <DenButton className="mt-5" variant="secondary" icon={RefreshCw} onClick={() => void retryBilling()}>
              重试
            </DenButton>
          </DenCard>
        ) : null}

        {accessState === "confirming" ? (
          <DenCard size="spacious" data-testid="openwork-web-confirming">
            <div className="flex items-start gap-4">
              <Loader2 className="mt-1 size-5 animate-spin text-blue-600" aria-hidden="true" />
              <div>
                <p className="text-[18px] font-medium text-gray-950">正在确认 OpenWork Web 订阅</p>
                <p className="mt-2 text-[14px] leading-6 text-gray-500">
                  通常只需片刻，付款确认后访问权限将自动开启。
                </p>
              </div>
            </div>
          </DenCard>
        ) : null}

        {accessState === "unsubscribed" && billing ? (
          <DenCard size="spacious" data-testid="openwork-web-purchase">
            <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-blue-600">OpenWork Web</p>
            <h2 className="mt-2 text-[22px] font-semibold tracking-[-0.03em] text-gray-950">组织浏览器访问权限</h2>
            <p className="mt-3 text-[14px] leading-6 text-gray-600">{OPENWORK_WEB_QUANTITY_EXPLANATION}</p>
            <div className="mt-5 rounded-2xl border border-gray-200 bg-gray-50 p-4" data-testid="openwork-web-price-breakdown">
              <p className="text-[22px] font-semibold tracking-[-0.03em] text-gray-950">
                {getOpenWorkWebQuantityDescription(billing.quantity)} × {unitPrice}
              </p>
              <p className="mt-1 text-[14px] text-gray-600">
                {expectedTotal} / 月
              </p>
            </div>
            <p className="mt-5 text-[13px] leading-5 text-gray-600" data-testid="openwork-web-checkout-explainer">
              付款确认后即可访问。费用会随已加入成员数量自动调整，待接受的邀请不计费。
            </p>
            {!billing.configured ? (
              <DenNotice className="mt-5" tone="neutral" message="此部署尚未配置 OpenWork Web 计费。" />
            ) : hasOngoingSubscription ? (
              <div className="mt-5 grid gap-4">
                <DenNotice
                  tone="warning"
                  message={billing.subscription?.paymentStatus === "payment_failed"
                    ? "此组织已有 OpenWork Web 订阅，但付款失败。请在“账单”中更新付款方式以恢复访问。"
                    : `此组织已有 OpenWork Web 订阅（${formatSubscriptionStatus(billing.subscription?.status ?? "unknown").toLowerCase()}），请在“账单”中管理现有订阅。`}
                />
                <DenButton variant="secondary" href={getBillingRoute(activeOrg?.slug)}>查看账单</DenButton>
              </div>
            ) : canPurchaseWeb ? (
              <div className="mt-5">
                <WebPurchaseButton disabled={checkoutBusy} loading={checkoutBusy} onClick={() => void startWebCheckout()} />
              </div>
            ) : (
              <DenNotice
                className="mt-5"
                tone="warning"
                message="请联系组织账单管理员购买 OpenWork Web，订阅生效后即可访问。"
              />
            )}
          </DenCard>
        ) : null}

        {accessState === "eligible" && billing ? (
          <DenCard size="spacious" data-testid="openwork-web-eligible">
            <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-emerald-700">
              {billing.accessSource === "complimentary" ? "免费访问权限" : "订阅已生效"}
            </p>
            <h2 className="mt-2 text-[22px] font-semibold tracking-[-0.03em] text-gray-950">OpenWork Web 已就绪</h2>
            <p className="mt-3 text-[14px] leading-6 text-gray-600">
              {billing.accessSource === "complimentary"
                ? `此组织的全部${getOpenWorkWebQuantityDescription(billing.quantity)}均可使用 OpenWork Web，无需 Stripe 订阅或按人付费。`
                : `此组织的${getOpenWorkWebQuantityDescription(billing.quantity)}已启用 OpenWork Web。`}
            </p>
            <div className="mt-5 flex flex-wrap gap-3">
              <WebOpenButton openworkWebUrl={runtimeConfig.openworkWebUrl} />
              <DenButton variant="secondary" href={getBillingRoute(activeOrg?.slug)}>查看账单</DenButton>
            </div>
          </DenCard>
        ) : null}
      </div>
    </DashboardPageTemplate>
  );
}
