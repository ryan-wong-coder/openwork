"use client";

import { Lock } from "lucide-react";
import { buttonVariants } from "../../_components/ui/button";
import { DenNotice } from "../../_components/ui/notice";
import { useOrgDashboard } from "../_providers/org-dashboard-provider";

const ENTERPRISE_CONTACT_URL =
  process.env.NEXT_PUBLIC_ENTERPRISE_CONTACT_URL || "https://openworklabs.com/enterprise#book";

type Props = {
  feature: string;
  /** Feature-specific state only; guidance for the current actor is added below. */
  detail?: string;
  /** Lowest plan that includes the feature. Team features link to billing; Enterprise features link to sales. */
  plan?: "team" | "enterprise";
  /** Billing page for the Team upgrade. Required when plan is "team". */
  billingHref?: string;
};

export function EnterprisePlanNotice(props: Props) {
  const { orgContext } = useOrgDashboard();
  const teamPlan = props.plan === "team";
  const planLabel = teamPlan ? "团队" : "企业版";
  const guidance = orgContext?.currentMember.isOwner
    ? "你可以更改套餐。"
    : "工作区所有者可以更改套餐。";

  return (
    <div className="mb-6" data-testid="enterprise-plan-notice">
      <DenNotice
        tone="neutral"
        presentation="inline"
        icon={Lock}
        className="flex-wrap px-0 [&>svg]:mt-0 [&>svg]:stroke-[1.5] [&>svg]:text-[var(--dls-text-secondary)] [&>span:first-of-type]:basis-64"
        message={
          <span className="text-[var(--dls-text-secondary)]">
            <span className="font-medium text-[var(--dls-text-primary)]" data-testid="enterprise-plan-notice-state">
              {props.feature} 属于 {planLabel} 套餐。
            </span>{" "}
            <span data-testid="enterprise-plan-notice-detail">
              {props.detail ?? "当前配置将继续生效。"}
            </span>{" "}
            <span data-testid="enterprise-plan-notice-guidance">{guidance}</span>
          </span>
        }
        action={teamPlan ? (
          <a href={props.billingHref ?? "/dashboard"} className={buttonVariants({ variant: "primary", size: "compact" })}>
            升级至团队版
          </a>
        ) : (
          <a
            href={ENTERPRISE_CONTACT_URL}
            target="_blank"
            rel="noreferrer"
            className={buttonVariants({ variant: "primary", size: "compact" })}
          >
            联系我们了解企业版价格
          </a>
        )}
      />
    </div>
  );
}
