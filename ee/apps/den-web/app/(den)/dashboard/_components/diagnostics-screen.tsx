"use client";

import { Activity } from "lucide-react";
import { getOrgAccessFlags } from "../../_lib/den-org";
import { DashboardPageTemplate } from "../../_components/ui/dashboard-page-template";
import { useOrgDashboard } from "../_providers/org-dashboard-provider";
import { EgressDiagnosticsCard } from "./egress-diagnostics-card";

export function DiagnosticsScreen() {
  const { orgContext } = useOrgDashboard();
  const access = getOrgAccessFlags(
    orgContext?.currentMember.role ?? "member",
    orgContext?.currentMember.isOwner ?? false,
    orgContext?.currentMember.permissions,
  );

  return (
    <DashboardPageTemplate
      icon={Activity}
      title="诊断"
      description="通过企业连接器使用的相同网络路径执行受控支持检查。"
    >
      <EgressDiagnosticsCard canView={access.canViewEgressDiagnostics} canManage={access.canManageEgressDiagnostics} />
    </DashboardPageTemplate>
  );
}
