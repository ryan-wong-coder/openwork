import { t } from "@/i18n";
import { BuiltAppPicker, BuiltDashboardTiles, useBuiltDashboardApps } from "./built-dashboard-apps";
import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Blocks, Check, Loader2, Plus, Sparkles } from "lucide-react";
import type { SavedAppSummary } from "@openwork/types/workflows";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useSavedApps, useAppsClient, dashboardManagementReason } from "../apps/use-apps";
import { AppActionsMenu, getAppUpdatePrompt } from "../apps/app-actions-menu";
import { GeneratedAppPreview, type GeneratedAppPreviewGeometry } from "../apps/generated-app-preview";
import { useWorkspace } from "@/react-app/shell/workspace-provider";
import { dashboardTileCacheScopeKey } from "./dashboard-tile-cache";
import { readDashboardTileGeometry, removeDashboardTileGeometry } from "./dashboard-tile-geometry";
import { LiveGeneratedApp, isLiveGeneratedApp } from "../apps/live-generated-app";
import type { DashboardLaunchEndpoint } from "./mcp-app-tile";
import { DashboardMasonry } from "./dashboard-masonry";
import { DashboardTileShell, type DashboardTileActions } from "./dashboard-tile-shell";
import { ShareDashboardButton } from "./share-dashboard-button";

export type CreateDashboardApp = (prompt: string) => Promise<void>;

function snapshotGeometryScopeKey(scope: ReturnType<typeof useAppsClient>["scope"]): string {
  return `${dashboardTileCacheScopeKey(scope[1] ?? null, scope[2] ?? null)}.snapshots.${encodeURIComponent(JSON.stringify(scope))}`;
}

export function DashboardApps({ onCreateApp, fallbackEndpoints, headerActionsTarget }: {
  onCreateApp: CreateDashboardApp;
  fallbackEndpoints?: DashboardLaunchEndpoint[];
  /** The window titlebar slot, like Library's. `undefined` renders the controls inline; `null` waits for the slot. */
  headerActionsTarget?: HTMLElement | null;
}) {
  const { available, client, orgId, query, scope, canManage } = useSavedApps();
  const cache = useQueryClient();
  const built = useBuiltDashboardApps();
  const [chooser, setChooser] = useState<"add" | "existing" | "saved" | null>(null);
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const placement = useMutation({
    mutationFn: async ({ appId, added }: { appId: string; added: boolean; geometry?: GeneratedAppPreviewGeometry }) => {
      if (!canManage) throw new Error(dashboardManagementReason);
      if (!client || !orgId) throw new Error("Sign in to update your dashboard.");
      await client.setAppOnDashboard(orgId, appId, added);
    },
    onSuccess: async (_result, { added, geometry }) => {
      await cache.invalidateQueries({ queryKey: ["saved-apps", ...scope] });
      if (!added && geometry) removeDashboardTileGeometry(geometry.scopeKey, geometry.entryId);
    },
  });
  const create = async () => {
    if (!canManage) return;
    setCreating(true); setError(null);
    try { await onCreateApp("Create one live app for my dashboard in one shot. Use my request to build and save one app that fetches fresh data with each viewer’s own connections whenever opened or refreshed. Handle the underlying workflow internally; do not ask me workflow questions. My app should "); setChooser(null); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not start a conversation. Try again."); }
    finally { setCreating(false); }
  };
  const apps = query.data?.items ?? [];
  const personal = apps.filter((app) => app.onDashboard);
  const matching = apps.filter((app) => app.view.title.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  const openAdd = () => { setChooser(built.ready ? "existing" : "add"); setError(null); placement.reset(); };
  const headerControls = (available && canManage) || built.ready ? <div className="flex items-center gap-2">
    {canManage && query.data?.sharingEnabled && personal.length > 0 ? <ShareDashboardButton key={JSON.stringify(scope)} apps={personal} /> : null}
    <Button className="shrink-0 rounded-lg" onClick={openAdd}><Plus className="size-4" />{t("interface.add_to_dashboard")}</Button>
  </div> : null;
  return <>
    {headerControls ? headerActionsTarget ? createPortal(headerControls, headerActionsTarget)
      : headerActionsTarget === undefined ? <div className="mb-6 flex justify-end">{headerControls}</div> : null : null}
    {query.isError ? <div className="mb-5 flex items-center gap-3"><p role="alert" className="text-sm">{t("interface.your_artifacts_could_not_be_loaded")}</p><Button variant="outline" onClick={() => void query.refetch()}>{t("session.remote_task_retry")}</Button></div> : null}
    {placement.error && !chooser ? <p role="alert" className="mb-4 text-sm text-destructive">{placement.error.message}</p> : null}
    <BuiltDashboardTiles built={built} fallbackEndpoints={fallbackEndpoints} onAdd={openAdd} />
    {available && personal.length ? <section className="mb-8" aria-label={t("interface.your_artifacts")}>
      <h2 className="mb-3 text-sm font-medium">{t("extensions.detail_chip_added_by_you")}</h2>
      <DashboardMasonry>{personal.map((app) => <SavedDashboardApp key={JSON.stringify([...scope, app.view.id])} app={app} fallbackEndpoints={fallbackEndpoints} onCreateApp={onCreateApp}
        removing={placement.isPending && placement.variables?.appId === app.view.id}
        onRemove={(geometry) => placement.mutate({ appId: app.view.id, added: false, geometry })} />)}</DashboardMasonry>
    </section> : (available && canManage) || built.ready ? (built.apps.some((app) => built.ids.includes(app.connectionId)) ? null : <section className="mb-8 flex min-h-96 flex-col items-center justify-center text-center" data-dashboard-empty>
      <div aria-hidden="true" className="mb-10 grid w-full max-w-xl grid-cols-[2fr_3fr_2fr] gap-4">{[0, 1, 2].map((index) => <div key={index} className="h-32 rounded-xl border border-dashed bg-muted/30 p-5">
        <div className="h-2.5 w-3/5 rounded-full bg-muted" />
        <div className="mt-3 h-6 w-10 rounded-md bg-muted" />
      </div>)}</div>
      <h2 className="text-xl font-semibold">{t("interface.pin_the_artifacts_you_check_every_day")}</h2>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">{t("interface.add_artifacts_your_team_shared_with_you_or_ones_you_made_they_stay_live_so_you_never_open_a_chat_to_")}</p>
      <Button className="mt-6 rounded-lg" onClick={openAdd}><Plus className="size-4" />{t("interface.add_an_artifact")}</Button>
    </section>) : available ? <p className="mb-8 text-xs text-muted-foreground">{t("interface.this_dashboard_has_no_artifacts_yet")}</p> : null}
    <Dialog open={(canManage || built.ready) && chooser !== null} onOpenChange={(open) => { if (!open && !creating && !placement.isPending) setChooser(null); }}>
      <DialogContent className={chooser === "existing" && built.ready ? "gap-0 overflow-hidden p-0 lg:top-[12vh] lg:max-w-xl lg:translate-y-0 lg:rounded-xl" : undefined}>
        <DialogHeader className={chooser === "existing" && built.ready ? "sr-only" : undefined}><DialogTitle>{chooser === "existing" || chooser === "saved" ? t("interface.choose_an_existing_artifact") : t("interface.add_to_your_dashboard")}</DialogTitle>
          {chooser === "add" ? <DialogDescription>{t("interface.create_something_useful_or_choose_an_artifact_already_available_to_you")}</DialogDescription> : null}</DialogHeader>
        {chooser === "existing" && built.ready ? <div><BuiltAppPicker key={JSON.stringify(scope)} built={built} onAdded={() => setChooser(null)} />{canManage && available ? <div className="flex gap-2 border-t p-2"><Button variant="ghost" size="sm" onClick={() => setChooser("add")}><Sparkles className="size-4" />{t("interface.create_with_openwork")}</Button>{apps.length ? <Button variant="ghost" size="sm" onClick={() => { setSearch(""); setChooser("saved"); }}>{t("interface.other_saved_artifacts")}</Button> : null}</div> : null}</div> : chooser === "existing" || chooser === "saved" ? <div className="space-y-4">
          <Button size="sm" variant="ghost" onClick={() => setChooser(built.ready ? "existing" : "add")}><ArrowLeft className="size-4" />{t("dashboard.modal_back")}</Button>
          <Input aria-label={t("interface.search_artifacts")} placeholder={t("interface.search_artifacts")} value={search} onChange={(event) => setSearch(event.target.value)} />
          <div className="max-h-80 space-y-2 overflow-auto">{matching.map((app) => <div key={app.view.id} className="flex items-center gap-3 rounded-lg border p-3">
            <Blocks className="size-4 shrink-0 text-muted-foreground" /><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{app.view.title}</p>{app.view.description ? <p className="line-clamp-2 text-xs text-muted-foreground">{app.view.description}</p> : null}</div>
            <Button variant="outline" size="sm" aria-label={`Add ${app.view.title}`} disabled={app.onDashboard || placement.isPending} onClick={() => placement.mutate({ appId: app.view.id, added: true })}>{app.onDashboard ? <><Check className="size-3.5" />{t("plugins.added")}</> : t("plugins.add")}</Button>
          </div>)}</div>
          {!matching.length ? <p className="text-sm text-muted-foreground">{apps.length ? t("interface.no_artifacts_match_your_search") : t("interface.there_are_no_saved_artifacts_to_choose_from_yet_create_one_with_openwork_to_get_started")}</p> : null}
        </div> : <div className="space-y-3 py-2">
          <button type="button" aria-label={t("interface.create_with_openwork")} className="flex w-full items-start gap-3 rounded-xl border p-4 text-left hover:bg-muted/50 disabled:opacity-50" onClick={() => void create()} disabled={creating}>
            {creating ? <Loader2 className="mt-0.5 size-5 animate-spin" /> : <Sparkles className="mt-0.5 size-5" />}<span><span className="block text-sm font-medium">{creating ? t("interface.opening_conversation") : t("interface.create_with_openwork")}</span><span className="mt-1 block text-sm text-muted-foreground">{t("interface.describe_what_you_want_build_and_refine_it_with_a_preview_beside_your_conversation")}</span></span>
          </button>
          <button type="button" aria-label={t("interface.choose_an_existing_artifact")} className="flex w-full items-start gap-3 rounded-xl border p-4 text-left hover:bg-muted/50" disabled={creating} onClick={() => { setSearch(""); setChooser("existing"); }}>
            <Blocks className="mt-0.5 size-5" /><span><span className="block text-sm font-medium">{t("interface.choose_an_existing_artifact")}</span><span className="mt-1 block text-sm text-muted-foreground">{t("interface.add_a_saved_artifact_you_already_have_access_to")}</span></span>
          </button>
        </div>}
        {error || placement.error ? <p role="alert" className="text-sm text-destructive">{error ?? placement.error?.message}</p> : null}
      </DialogContent>
    </Dialog>
  </>;
}

function SavedDashboardApp({ app, onRemove, removing, onCreateApp, fallbackEndpoints }: { fallbackEndpoints?: DashboardLaunchEndpoint[]; app: SavedAppSummary; onRemove: (geometry?: GeneratedAppPreviewGeometry) => void; removing: boolean; onCreateApp: CreateDashboardApp }) {
  const navigate = useNavigate();
  const { client, orgId, scope, canManage } = useAppsClient();
  const { workspaceId } = useWorkspace();
  const detail = useQuery({
    queryKey: ["app-preview", ...scope, app.view.id, undefined, undefined],
    enabled: Boolean(client && orgId) && !isLiveGeneratedApp(app.view),
    queryFn: () => {
      if (!client || !orgId) throw new Error("Sign in to open this artifact.");
      return client.getSavedApp(orgId, app.view.id);
    },
  });
  const savedRevision = app.view.revisions.find((revision) => revision.id === app.view.activeRevisionId);
  const liveRevision = isLiveGeneratedApp(app.view) ? savedRevision : undefined;
  const snapshotRevision = !isLiveGeneratedApp(app.view) ? detail.data?.revision ?? savedRevision : undefined;
  const geometryScopeKey = snapshotGeometryScopeKey(scope);
  const geometryEntryId = snapshotRevision ? JSON.stringify([app.view.id, snapshotRevision.id, snapshotRevision.resourceUri]) : null;
  const geometry = geometryEntryId ? { scopeKey: geometryScopeKey, entryId: geometryEntryId } : undefined;
  const reserved = useMemo(() => geometryEntryId && workspaceId
    ? readDashboardTileGeometry(geometryScopeKey, geometryEntryId, workspaceId) : null,
  [geometryScopeKey, geometryEntryId, workspaceId]);
  const updatePrompt = canManage && app.canManage && !detail.isError ? getAppUpdatePrompt(isLiveGeneratedApp(app.view) ? { ...app, revision: liveRevision ?? null, html: null, payload: null, previewNotice: null } : detail.data) : undefined;
  const update = useMutation({ mutationFn: onCreateApp });
  const onUpdate = updatePrompt ? () => { if (!update.isPending && !removing) update.mutate(updatePrompt); } : undefined;
  const renderActions: DashboardTileActions = (props) => <AppActionsMenu appId={app.view.id} title={app.view.title}
    canManage={app.canManage} canDelete={app.canManage} onRemove={() => onRemove(geometry)} onUpdate={onUpdate} busy={removing || update.isPending}
    onOpen={() => navigate(`/dashboard/apps/${app.view.id}`)} {...props} />;
  const live = liveRevision ? { view: app.view, revision: liveRevision }
    : !isLiveGeneratedApp(app.view) && !detail.isError && detail.data && isLiveGeneratedApp(detail.data.view) && detail.data.revision ? { view: detail.data.view, revision: detail.data.revision } : null;
  const hasPreview = !isLiveGeneratedApp(app.view) && Boolean(detail.data?.html && detail.data.payload && detail.data.revision);
  return <article className="min-w-0" style={{ minHeight: detail.isPending ? reserved?.outerHeight : undefined }} data-personal-dashboard-app={app.view.id}>
      {live ? <LiveGeneratedApp view={live.view} revision={live.revision} fallbackEndpoints={fallbackEndpoints} renderActions={renderActions} />
        : <DashboardTileShell title={app.view.title} compact={(hasPreview && !detail.isError) || (detail.isPending && Boolean(reserved))} renderActions={renderActions}>
        {isLiveGeneratedApp(app.view) ? <p role="status" className="py-4 text-sm text-muted-foreground">{t("interface.this_artifact_has_no_saved_version_ready_to_open")}</p>
        : detail.isPending ? <p role="status" className={`text-sm text-muted-foreground${reserved ? "" : " py-4"}`}>{t("interface.loading_artifact")}</p>
        : detail.isError ? <div className="space-y-3 py-4"><p role="alert" className="text-sm">{t("interface.this_artifact_could_not_be_loaded")}</p><Button variant="outline" size="sm" onClick={() => void detail.refetch()}>{t("session.remote_task_retry")}</Button></div>
        : detail.data.html && detail.data.payload && detail.data.revision ?
          <GeneratedAppPreview html={detail.data.html} payload={detail.data.payload} title={app.view.title} revision={detail.data.revision} presentation="dashboard" geometry={geometry} />
        : <div className="flex flex-wrap items-center gap-x-3">
          <p className="py-4 text-sm text-muted-foreground">{detail.data.previewNotice}</p>
          {onUpdate ? <Button variant="outline" size="sm" disabled={removing || update.isPending} onClick={onUpdate}>{update.isPending ? t("interface.opening_conversation") : t("interface.update_artifact")}</Button> : null}
        </div>}
        </DashboardTileShell>}
      {update.isError ? <p role="alert" className="text-sm text-destructive">{update.error instanceof Error ? update.error.message : t("interface.could_not_start_a_conversation_try_again")}</p> : null}
  </article>;
}
