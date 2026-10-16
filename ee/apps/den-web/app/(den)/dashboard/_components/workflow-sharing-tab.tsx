import type { ReactNode } from "react";
import { DenNotice } from "../../_components/ui/notice";

export function WorkflowSharingTab({
  canEdit,
  pluginAccess,
}: {
  canEdit: boolean;
  pluginAccess: ReactNode | null;
}) {
  return (
    <div className="grid gap-6" data-tab="sharing" role="tabpanel" aria-label="共享">
      <DenNotice
        tone="neutral"
        message={canEdit ? "你可以编辑与运行此工作流。" : "你可以运行此工作流。"}
      />
      {pluginAccess ?? <DenNotice tone="neutral" message="此工作流直接与你共享。" />}
    </div>
  );
}
