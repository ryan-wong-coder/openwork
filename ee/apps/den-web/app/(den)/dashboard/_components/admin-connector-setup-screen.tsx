"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { DenButton } from "../../_components/ui/button";
import { getAddConnectorRoute, getMcpConnectionRoute, getMcpConnectionsRoute, getOrgAccessFlags } from "../../_lib/den-org";
import { useOrgDashboard } from "../_providers/org-dashboard-provider";
import { type AccessDraft, accessPeopleIds, peopleLabel } from "./access-summary";
import { useConnectorSetup } from "./connector-setup";
import { ApiKeyFields, ApiKeySchemeAdvanced, OAuthAppFields } from "./connector-setup-fields";
import { useConnectorTarget } from "./connector-setup-screen";
import { useDenToast } from "./den-toast";
import { ItemHeader, ItemPage, SectionTitle, StepFooter } from "./item-header";
import { ConfirmDialog } from "./item-list";
import { ConnectorLogo } from "./item-logo";
import { useSaveConnectionAccess } from "./item-sharing";
import { DEFAULT_API_KEY_AUTH_SCHEME, type ExternalMcpApiKeyAuthScheme, type ExternalMcpCredentialMode, useUpdateMcpConnection, useCheckMcpConnection } from "./mcp-connections-data";
import { usesMemberApiKey } from "./member-api-key";
import { SetupChecks } from "./setup-checks";
import { WhoCanUseIt } from "./who-can-use-it";

function SignInChoice({ name, value, onChange, disabled, kind = "oauth", sharedDescription }: {
  name: string;
  value: ExternalMcpCredentialMode;
  onChange: (value: ExternalMcpCredentialMode) => void;
  disabled: boolean;
  kind?: "oauth" | "api_key";
  sharedDescription?: string;
}) {
  const options: { value: ExternalMcpCredentialMode; title: string; description: string }[] = [
    kind === "api_key"
      ? { value: "per_member", title: "每人添加自己的密钥", description: `共用一个 ${name} 连接，每个人添加自己的密钥。` }
      : { value: "per_member", title: "每人分别登录", description: `每个人使用自己的 ${name} 账户。` },
    kind === "api_key"
      ? { value: "shared", title: "所有人共用一个密钥", description: sharedDescription ?? `所有人共用一个 ${name} API 密钥。` }
      : { value: "shared", title: "所有人共用一个账户", description: sharedDescription ?? `所有人共用你登录的 ${name} 账户。` },
  ];
  return (
    <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="连接方式">
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <label
            key={option.value}
            className={`flex cursor-pointer items-start gap-3 rounded-2xl border bg-white px-4 py-3.5 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-gray-200 ${selected ? "border-gray-400" : "border-gray-100 hover:border-gray-200"}`}
          >
            <input
              type="radio"
              name="sign-in-mode"
              value={option.value}
              checked={selected}
              disabled={disabled}
              onChange={() => onChange(option.value)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-gray-900"
            />
            <span className="flex flex-col gap-0.5">
              <span className="text-[14px] font-medium leading-5 text-gray-900">{option.title}</span>
              <span className="text-[13px] leading-[18px] text-gray-500">{option.description}</span>
            </span>
          </label>
        );
      })}
    </div>
  );
}

/** C3 and C4: the checks fill in, then the admin picks how people sign in and who gets it. */
export function AdminConnectorSetupScreen({ catalogId }: { catalogId: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const toast = useDenToast();
  const { orgSlug, orgContext } = useOrgDashboard();
  const canShareWithEveryone = orgContext
    ? getOrgAccessFlags(orgContext.currentMember.role, orgContext.currentMember.isOwner, orgContext.currentMember.permissions).canShareWithEveryone
    : false;
  const { target, loading, missing, failed } = useConnectorTarget(catalogId);
  const updateConnection = useUpdateMcpConnection();
  const checkConnection = useCheckMcpConnection();
  const saveAccess = useSaveConnectionAccess();
  const viewerId = orgContext?.currentMember.id ?? null;
  const [mode, setMode] = useState<ExternalMcpCredentialMode | null>(null);
  const [apiKeyAuthScheme, setApiKeyAuthScheme] = useState<ExternalMcpApiKeyAuthScheme>(DEFAULT_API_KEY_AUTH_SCHEME);
  const [draft, setDraft] = useState<AccessDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmSwitch, setConfirmSwitch] = useState(false);
  const setup = useConnectorSetup({
    mode: "admin",
    target,
    initialConnectionId: searchParams.get("connection"),
    onConnectionCreated: (connectionId) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("connection", connectionId);
      router.replace(`?${params.toString()}`, { scroll: false });
    },
  });

  const name = target?.name ?? "";
  const back = { href: getAddConnectorRoute(orgSlug), label: "添加连接器" };

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
  if (!target || !orgContext) {
    return <ItemPage><ItemHeader back={back} title={loading || !orgContext ? "正在加载…" : "添加连接器"} /></ItemPage>;
  }

  const connection = setup.connection;
  const signsIn = connection ? connection.authType === "oauth" : true;
  const usesKey = connection?.authType === "apikey";
  const usesIndividualKeys = Boolean(connection && usesMemberApiKey(connection));
  const chosenMode: ExternalMcpCredentialMode = mode ?? connection?.credentialMode ?? (setup.method === "api_key" ? "shared" : "per_member");
  const access: AccessDraft = draft ?? (connection?.access
    ? { orgWide: connection.access.orgWide, memberIds: connection.access.memberIds, teamIds: connection.access.teamIds }
    : { orgWide: false, memberIds: viewerId ? [viewerId] : [], teamIds: [] });
  const reached = accessPeopleIds(access, orgContext, viewerId).length;
  const me = orgContext.members.find((member) => member.id === viewerId);
  const viewerName = me?.user.name || me?.user.email || "你";
  const switchingToShared = signsIn && chosenMode === "shared" && connection?.credentialMode === "per_member";
  const ready = setup.allDone && Boolean(connection);

  const checks = setup.checks.map((check) => {
    if (check.id === "sign-in" && setup.canSignIn) {
      return { ...check, action: <DenButton size="sm" onClick={() => void setup.startSignIn()}>{`使用 ${name} 登录`}</DenButton> };
    }
    if (check.id === "sign-in-method" && setup.needsInput) {
      return {
        ...check,
        body: setup.method === "api_key"
          ? (
            <div className="flex flex-col gap-3">
              <SignInChoice name={name} value={chosenMode} onChange={setMode} disabled={setup.saving} kind="api_key" />
              <ApiKeySchemeAdvanced value={apiKeyAuthScheme} onChange={setApiKeyAuthScheme} disabled={setup.saving} testId="connector-setup-api-key-auth-scheme" />
              {chosenMode === "shared" ? (
                <ApiKeyFields name={name} saving={setup.saving} error={setup.saveError} onSave={(apiKey) => void setup.saveApiKey(apiKey, apiKeyAuthScheme)} />
              ) : (
                <div className="flex flex-col items-start gap-2">
                  <DenButton size="sm" loading={setup.saving} onClick={() => void setup.savePerMemberApiKeys(apiKeyAuthScheme)}>使用个人密钥</DenButton>
                  {setup.saveError ? <p className="text-[12px] text-red-600" role="alert">{setup.saveError}</p> : null}
                </div>
              )}
            </div>
          )
          : <OAuthAppFields secretRequired={setup.secretRequired} saving={setup.saving} error={setup.saveError} onSave={(input) => void setup.saveOAuthApp(input)} />,
      };
    }
    return check;
  });

  async function cancel() {
    setBusy(true);
    await setup.discard();
    router.push(getMcpConnectionsRoute(orgSlug));
  }

  async function switchToShared() {
    if (!connection) return;
    await updateConnection.mutateAsync({
      connectionId: connection.id,
      expectedUpdatedAt: connection.updatedAt ?? new Date().toISOString(),
      name: connection.name,
      url: connection.url,
      authType: connection.authType,
      credentialMode: "shared",
      exposeDirectly: connection.exposeDirectly,
      access,
    });
  }

  async function add() {
    if (!connection) return;
    setBusy(true);
    setError(null);
    try {
      await saveAccess(connection.id, access);
      // Individual-key setup publishes the connection; each person's key is
      // checked when they enroll it, not against an admin's nonexistent key.
      const checked = !usesIndividualKeys
        ? await checkConnection.mutateAsync(connection.id) : null;
      const connectionId = connection.id;
      toast({
        title: usesIndividualKeys ? `${name} 已设置` : checked?.status === "could_not_verify" ? `无法验证 ${name}` : `${name} 已就绪`,
        description: `${reached > 0 ? `${peopleLabel(reached)}可在“我的资源库”中找到它。` : "目前仅你拥有此项。"}`,
        action: { label: "查看", onClick: () => router.push(getMcpConnectionRoute(orgSlug, connectionId)) },
      });
      router.push(getMcpConnectionsRoute(orgSlug));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存失败，请重试。");
    } finally {
      setBusy(false);
    }
  }

  if (!ready) {
    return (
      <ItemPage testId="connector-setup">
        <ItemHeader
          back={back}
          logo={<ConnectorLogo name={name} url={target.url} size="md" />}
          title={`添加 ${name}`}
        />
        <SetupChecks checks={checks} />
        <StepFooter note={`步骤 ${setup.stepNumber} / ${checks.length}`}>
          <DenButton variant="secondary" loading={busy} onClick={() => void cancel()}>取消</DenButton>
        </StepFooter>
      </ItemPage>
    );
  }

  return (
    <ItemPage testId="connector-setup">
      <ItemHeader
        back={back}
        logo={<ConnectorLogo name={name} url={target.url} size="md" />}
        title={usesIndividualKeys ? `${name} 已设置` : `${name} 已通过全部 ${checks.length} 项检查`}
      />
      {signsIn || usesKey ? (
        <section className="flex flex-col gap-2.5">
          <SectionTitle title="连接方式" />
          <SignInChoice
            name={name}
            value={chosenMode}
            onChange={setMode}
            disabled={busy || usesKey}
            kind={usesKey ? "api_key" : "oauth"}
            sharedDescription={usesKey ? `所有人使用你添加的 ${name} API 密钥。` : undefined}
          />
        </section>
      ) : null}
      <section className="flex flex-col gap-2.5">
        <SectionTitle title="谁可以使用" />
        <WhoCanUseIt
          value={access}
          onChange={setDraft}
          members={orgContext.members}
          teams={orgContext.teams}
          owner={viewerId ? { id: viewerId, name: viewerName, isYou: true } : null}
          canShareWithEveryone={canShareWithEveryone}
          everyoneOffDescription="已关闭，仅下方人员与团队可使用。"
          disabled={busy}
        />
      </section>
      {error ? <p className="text-[13px] text-red-600" role="alert">{error}</p> : null}
      <StepFooter note={switchingToShared
        ? `接下来，登录所有人将共用的 ${name} 账户。`
        : reached > 0 ? `${peopleLabel(reached)}可在“我的资源库”中找到 ${name}。` : `只有你能使用 ${name}。`}
      >
        <DenButton variant="secondary" disabled={busy} onClick={() => void cancel()}>取消</DenButton>
        <DenButton loading={busy} onClick={() => (switchingToShared ? setConfirmSwitch(true) : void add())}>{switchingToShared ? "继续" : `添加 ${name}`}</DenButton>
      </StepFooter>
      <ConfirmDialog
        confirm={confirmSwitch ? {
          title: "切换为所有人共用一个账户？",
          description: `此操作会退出 ${name}。接下来，登录所有人将共用的 ${name} 账户。`,
          action: "Sign out and continue",
        } : null}
        onConfirm={switchToShared}
        onClose={() => setConfirmSwitch(false)}
      />
    </ItemPage>
  );
}
