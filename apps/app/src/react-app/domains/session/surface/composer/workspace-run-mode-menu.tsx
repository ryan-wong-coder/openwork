import { t } from "@/i18n";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Hand, LoaderCircle, ShieldAlert, ShieldCheck } from "lucide-react";
import type { OpenworkServerClient, WorkspaceRunMode } from "@/app/lib/openwork-server";
import { isDesktopRuntime } from "@/app/lib/runtime-env";
import { toast } from "@/components/ui/sonner";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useDesktopRestriction } from "@/react-app/domains/cloud/desktop-config-provider";
import { useFeatureFlagsPreferences } from "@/react-app/domains/settings/state/feature-flags-preferences";

type Props = { client: OpenworkServerClient | null; workspaceId: string | null; busy: boolean };

function getModes() { return [
  { value: "approve", label: t("session_copy.ask_before_actions"), description: t("session_copy.pause_for_tool_approval_unless_a_workspace_rule_allows_it"), icon: Hand },
  { value: "default", label: t("session_copy.workspace_defaults"), description: t("session_copy.use_your_existing_setup_to_decide_when_to_ask"), icon: ShieldCheck },
  { value: "run-everything", label: t("session_copy.keep_going"), description: t("session_copy.allow_tools_by_default_including_files_outside_this_workspace"), icon: ShieldAlert },
] satisfies { value: WorkspaceRunMode; label: string; description: string; icon: typeof Hand }[]; }

export function WorkspaceRunModeMenu(props: Props) {
  const { workspaceRunModeEnabled } = useFeatureFlagsPreferences();
  const restricted = useDesktopRestriction("allowControlSettings");
  if (!workspaceRunModeEnabled || restricted || !isDesktopRuntime() || !props.client || !props.workspaceId) return null;
  // Remount on endpoint/workspace changes so a pending confirmation cannot
  // apply the previous pane's choice to a newly selected workspace.
  return <WorkspaceRunModePicker key={`${props.client.baseUrl}:${props.workspaceId}`} client={props.client} workspaceId={props.workspaceId} busy={props.busy} />;
}

function WorkspaceRunModePicker({ client, workspaceId, busy }: { client: OpenworkServerClient; workspaceId: string; busy: boolean }) {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const queryClient = useQueryClient();
  const queryKey = ["workspace-run-mode", client.baseUrl, workspaceId];
  const mode = useQuery({ queryKey, queryFn: () => client.getWorkspaceRunMode(workspaceId), retry: false });
  const mutation = useMutation({
    mutationKey: queryKey,
    mutationFn: (value: WorkspaceRunMode) => client.setWorkspaceRunMode(workspaceId, value),
    onSuccess: (result) => {
      queryClient.setQueryData(queryKey, result);
      setConfirm(false);
      setOpen(false);
      if (result.refreshPending) toast.warning(result.reason ?? t("session_copy.saved_reload_this_workspace_before_relying_on_the_new_mode"));
      else toast.success(t("session_copy.workspace_run_mode_updated"));
    },
    onError: (error: Error) => {
      toast.error(error.message);
      void mode.refetch();
    },
  });
  const modes = getModes();
  const selected = modes.find((item) => item.value === mode.data?.mode);
  const label = mode.isError ? t("session_copy.unavailable") : selected?.label ?? (mode.isPending ? t("session_copy.loading") : t("session_copy.custom_rules"));
  const Icon = mode.data?.supported === false || mode.isError || mode.data?.refreshPending ? ShieldAlert : selected?.icon ?? ShieldCheck;
  const locked = busy || mutation.isPending || mode.isFetching || !mode.data?.supported;
  const select = (value: unknown) => {
    if (locked || (value !== "default" && value !== "approve" && value !== "run-everything")) return;
    if (value === "run-everything") {
      setOpen(false);
      setConfirm(true);
    } else mutation.mutate(value);
  };
  return (
    <>
      <DropdownMenu open={open} onOpenChange={(next) => { setOpen(next); if (next) void mode.refetch(); }}>
        <DropdownMenuTrigger
          data-testid="workspace-run-mode-trigger"
          aria-label={t("session_copy.run_mode_label", { name: label, status: mode.data?.refreshPending ? t("session_copy.refresh_pending") : "" })}
          title={t("session_copy.run_mode_label", { name: label, status: mode.data?.refreshPending ? t("session_copy.refresh_pending") : "" })}
          className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-gray-3 ${mode.data?.mode === "run-everything" || mode.data?.refreshPending ? "text-orange-600 dark:text-orange-400" : "text-gray-10"}`}
        >
          {mutation.isPending ? <LoaderCircle className="size-4 animate-spin" /> : <Icon className="size-4" />}
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" sideOffset={10} className="w-[min(390px,calc(100vw-32px))] p-2">
          <DropdownMenuGroup>
            <DropdownMenuLabel className="px-3 text-sm">{t("interface.how_should_openwork_handle_approvals")}</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={mode.data?.mode ?? ""}>
              {modes.map((item) => (
                <DropdownMenuRadioItem key={item.value} value={item.value} onClick={() => select(item.value)} aria-label={item.label} data-testid={`run-mode-${item.value}`} disabled={locked} className={`gap-3 py-3 ${item.value === "run-everything" ? "text-orange-600 dark:text-orange-400" : ""}`}>
                  <item.icon className="size-5" />
                  <span className="min-w-0">
                    <span className="block">{item.label}</span>
                    <span className="mt-0.5 block text-xs font-normal text-muted-foreground">{item.description}</span>
                  </span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <p className="px-3 py-2 text-xs text-muted-foreground">{t("interface.applies_to_every_chat_in_this_workspace_specific_workspace_rules_still_apply")}</p>
          {busy ? <p role="status" className="px-3 pb-2 text-xs text-muted-foreground">{t("interface.wait_for_this_workspace_to_finish_before_changing_its_mode")}</p> : null}
          {mode.isError ? <p role="alert" className="px-3 pb-2 text-xs text-destructive">{t("interface.run_modes_are_unavailable")} {mode.error.message}</p> : null}
          {mode.data?.reason ? <p role="status" className="px-3 pb-2 text-xs text-muted-foreground">{mode.data.reason}</p> : null}
          {mode.data?.refreshPending ? <p role="status" className="px-3 pb-2 text-xs text-orange-600">{t("interface.saved_but_engine_refresh_is_pending_select_the_mode_again_to_retry")}</p> : null}
        </DropdownMenuContent>
      </DropdownMenu>
      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("interface.let_openwork_keep_going")}</AlertDialogTitle>
            <AlertDialogDescription>{t("interface.this_changes_every_chat_in_this_workspace_tools_can_edit_or_delete_files_run_commands_and_use_the_ne")} </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={mutation.isPending}>{t("settings.environment.cancel")}</AlertDialogCancel>
            <AlertDialogAction disabled={locked} onClick={() => mutation.mutate("run-everything")}>{t("interface.enable_keep_going")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
