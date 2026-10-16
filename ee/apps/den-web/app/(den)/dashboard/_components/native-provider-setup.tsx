"use client";

import { useRouter } from "next/navigation";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { DenButton } from "../../_components/ui/button";
import { DenInput } from "../../_components/ui/input";
import { getAddConnectorRoute, getMcpConnectionRoute, getMcpConnectionsRoute } from "../../_lib/den-org";
import { useOrgDashboard } from "../_providers/org-dashboard-provider";
import { GOOGLE_WORKSPACE_QUICK_ADD_ID, MICROSOFT_365_QUICK_ADD_ID, type NativeProviderKey } from "./connector-catalog";
import { useDenToast } from "./den-toast";
import {
  GOOGLE_WORKSPACE_DEFAULT_FEATURES,
  GOOGLE_WORKSPACE_PERMISSION_GROUPS,
  type NativePermissionGroup,
} from "./google-workspace-permissions";
import { ItemHeader, ItemPage, SectionTitle, StepFooter } from "./item-header";
import { DetailRows, ItemPanel } from "./item-list";
import { ConnectorLogo } from "./item-logo";
import { McpCredentialInput } from "./mcp-credential-input";
import { useCreateNativeProviderConnection, useNativeProviderClient, useSaveNativeProviderClient } from "./mcp-connections-data";
import { MICROSOFT_365_DEFAULT_FEATURES, MICROSOFT_365_PERMISSION_GROUPS } from "./microsoft-365-permissions";

type ProviderCopy = {
  name: string;
  url: string;
  consoleLabel: string;
  consoleUrl: string;
  defaultFeatures: readonly string[];
  groups: readonly NativePermissionGroup[];
  tenant: boolean;
  clientIdPlaceholder: string;
  secretPlaceholder: string;
};

const PROVIDERS: Record<NativeProviderKey, ProviderCopy> = {
  [GOOGLE_WORKSPACE_QUICK_ADD_ID]: {
    name: "Google Workspace",
    url: "https://workspace.google.com",
    consoleLabel: "打开 Google Cloud 控制台",
    consoleUrl: "https://console.cloud.google.com/apis/credentials",
    defaultFeatures: GOOGLE_WORKSPACE_DEFAULT_FEATURES,
    groups: GOOGLE_WORKSPACE_PERMISSION_GROUPS,
    tenant: false,
    clientIdPlaceholder: "1234567890-abc.apps.googleusercontent.com",
    secretPlaceholder: "客户端密钥",
  },
  [MICROSOFT_365_QUICK_ADD_ID]: {
    name: "Microsoft 365",
    url: "https://www.microsoft.com/microsoft-365",
    consoleLabel: "打开 Entra 应用注册",
    consoleUrl: "https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade",
    defaultFeatures: MICROSOFT_365_DEFAULT_FEATURES,
    groups: MICROSOFT_365_PERMISSION_GROUPS,
    tenant: true,
    clientIdPlaceholder: "应用程序（客户端）ID",
    secretPlaceholder: "客户端密钥值，而非密钥 ID",
  },
};

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[12px] font-medium text-gray-700">{label}</span>
      {children}
    </label>
  );
}

/**
 * The org OAuth app and permissions for Google Workspace or Microsoft 365.
 * `create` adds a new Google Workspace connection; otherwise it saves the
 * client for `clientProviderId` (a connection id or the provider alias).
 */
export function NativeProviderSettings({ providerKey, clientProviderId, create, onSaved, footer }: {
  providerKey: NativeProviderKey;
  clientProviderId: string;
  create: boolean;
  onSaved: (connectionId: string, name: string) => void;
  footer: (input: { save: () => void; saving: boolean; disabled: boolean; label: string }) => ReactNode;
}) {
  const provider = PROVIDERS[providerKey];
  const clientConfig = useNativeProviderClient(clientProviderId, true);
  const createNative = useCreateNativeProviderConnection();
  const saveClient = useSaveNativeProviderClient();
  const [name, setName] = useState(provider.name);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [tenantId, setTenantId] = useState("");
  const [features, setFeatures] = useState<string[]>([...provider.defaultFeatures]);
  const [replacing, setReplacing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const prefilled = useRef(false);

  const creatingGoogle = create && providerKey === GOOGLE_WORKSPACE_QUICK_ADD_ID;
  const configured = !creatingGoogle && (clientConfig.data?.configured ?? false);

  useEffect(() => {
    if (!configured || prefilled.current || !clientConfig.data) return;
    prefilled.current = true;
    setFeatures(clientConfig.data.features);
  }, [clientConfig.data, configured]);

  const redirectUri = clientConfig.data?.redirectUri ?? "";
  const showCredentials = !clientConfig.isLoading && (!configured || replacing);
  const saving = createNative.isPending || saveClient.isPending;
  const credentialsIncomplete = showCredentials && (!clientId.trim() || !clientSecret.trim() || (provider.tenant && !tenantId.trim()));
  const disabled = clientConfig.isLoading || saving || credentialsIncomplete || (creatingGoogle && !name.trim());
  const label = configured && !replacing ? "保存权限" : configured ? "保存新凭据" : `添加 ${provider.name}`;

  function toggle(feature: string) {
    setFeatures((current) => current.includes(feature) ? current.filter((entry) => entry !== feature) : [...current, feature]);
  }

  async function copy() {
    if (!redirectUri) return;
    try {
      await navigator.clipboard.writeText(redirectUri);
      setCopied(true);
    } catch {
      setError("复制失败，请选中地址后手动复制。");
    }
  }

  async function save() {
    setError(null);
    const credentials = showCredentials
      ? { clientId: clientId.trim(), clientSecret: clientSecret.trim(), ...(provider.tenant ? { tenantId: tenantId.trim() } : {}) }
      : {};
    try {
      if (creatingGoogle) {
        const created = await createNative.mutateAsync({
          nativeProviderKey: providerKey,
          name: name.trim(),
          oauthClient: { clientId: clientId.trim(), clientSecret: clientSecret.trim(), features },
        });
        onSaved(created.id, created.name || name.trim());
        return;
      }
      await saveClient.mutateAsync({ providerId: clientProviderId, ...credentials, features });
      setReplacing(false);
      setClientSecret("");
      onSaved(clientProviderId, provider.name);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存失败，请重试。");
    }
  }

  return (
    <div className="flex flex-col gap-6" data-testid={`native-provider-${providerKey}`}>
      {creatingGoogle ? (
        <section className="flex flex-col gap-2.5">
          <SectionTitle title="名称" />
          <DenInput value={name} onChange={(event) => setName(event.target.value)} aria-label="名称" placeholder={provider.name} />
        </section>
      ) : null}

      <section className="flex flex-col gap-2.5">
        <SectionTitle
          title="重定向 URI"
          meta={<a href={provider.consoleUrl} target="_blank" rel="noopener noreferrer" className="font-medium text-gray-600 underline-offset-2 hover:text-gray-900 hover:underline">{provider.consoleLabel}</a>}
        />
        <div className="flex items-center gap-2">
          <p className="min-w-0 flex-1 truncate rounded-lg border border-gray-200 bg-white px-3 py-2.5 font-mono text-[12px] text-gray-900" data-testid="native-provider-redirect-uri">
            {redirectUri || (clientConfig.error ? "地址加载失败，请重新加载页面。" : "正在加载…")}
          </p>
          <DenButton variant="secondary" size="sm" disabled={!redirectUri} onClick={() => void copy()}>{copied ? "已复制" : "复制"}</DenButton>
        </div>
      </section>

      <section className="flex flex-col gap-2.5">
        <SectionTitle
          title="OAuth 应用"
          meta={configured && !replacing ? (
            <button type="button" className="font-medium text-gray-600 underline-offset-2 hover:text-gray-900 hover:underline" onClick={() => {
              setClientId(clientConfig.data?.clientId ?? "");
              setTenantId(clientConfig.data?.tenantId ?? "");
              setClientSecret("");
              setReplacing(true);
            }}>替换凭据</button>
          ) : replacing ? (
            <button type="button" className="font-medium text-gray-600 underline-offset-2 hover:text-gray-900 hover:underline" onClick={() => setReplacing(false)}>保留已保存的凭据</button>
          ) : undefined}
        />
        {clientConfig.isLoading ? <ItemPanel><p className="px-5 py-3 text-[13px] text-gray-500">正在检查已保存的凭据…</p></ItemPanel> : null}
        {configured && !replacing ? (
          <DetailRows rows={[
            ...(provider.tenant ? [{ label: "租户 ID", value: <span className="font-mono">{clientConfig.data?.tenantId ?? "已保存"}</span> }] : []),
            { label: "客户端 ID", value: <span className="font-mono">{clientConfig.data?.clientId ?? "已保存"}</span> },
            { label: "客户端密钥", value: "Saved" },
          ]} />
        ) : null}
        {showCredentials ? (
          <div className="flex flex-col gap-3">
            {provider.tenant ? (
              <Field label="目录（租户）ID">
                <McpCredentialInput kind="identifier" name={`${providerKey}-tenant-id`} data-testid="native-provider-tenant-id" value={tenantId} onChange={(event) => setTenantId(event.target.value)} placeholder="00000000-0000-0000-0000-000000000000" />
              </Field>
            ) : null}
            <Field label="客户端 ID">
              <McpCredentialInput kind="identifier" name={`${providerKey}-oauth-client-id`} data-testid="native-provider-client-id" value={clientId} onChange={(event) => setClientId(event.target.value)} placeholder={provider.clientIdPlaceholder} />
            </Field>
            <Field label="客户端密钥">
              <McpCredentialInput kind="secret" name={`${providerKey}-oauth-client-secret`} data-testid="native-provider-client-secret" value={clientSecret} onChange={setClientSecret} placeholder={provider.secretPlaceholder} />
            </Field>
          </div>
        ) : null}
      </section>

      <section className="flex flex-col gap-2.5">
        <SectionTitle title="你的 AI 可以做什么" meta={`${features.length} 已开启`} />
        <ItemPanel>
          {provider.groups.map((group) => (
            <fieldset key={group.name} className="flex flex-col gap-2 px-5 py-3.5">
              <legend className="sr-only">{group.name}</legend>
              <p className="text-[13px] font-medium text-gray-900" aria-hidden>{group.name}</p>
              {group.permissions.map((permission) => (
                <label key={permission.key} className="flex items-start gap-2.5 text-[13px] leading-5 text-gray-700">
                  <input
                    type="checkbox"
                    data-feature={permission.key}
                    className="mt-0.5 h-4 w-4 shrink-0 accent-gray-900"
                    checked={features.includes(permission.key)}
                    disabled={clientConfig.isLoading || saving}
                    onChange={() => toggle(permission.key)}
                  />
                  <span className="flex flex-col">
                    <span>{permission.label}</span>
                    {permission.detail ? <span className="text-[12px] leading-4 text-gray-500">{permission.detail}</span> : null}
                  </span>
                </label>
              ))}
            </fieldset>
          ))}
        </ItemPanel>
      </section>

      {error ? <p className="text-[13px] text-red-600" role="alert">{error}</p> : null}
      {footer({ save: () => void save(), saving, disabled, label })}
    </div>
  );
}

/** Add Google Workspace or Microsoft 365 as a full page: one OAuth app, then each person signs in. */
export function NativeProviderSetupScreen({ providerKey }: { providerKey: NativeProviderKey }) {
  const router = useRouter();
  const toast = useDenToast();
  const { orgSlug } = useOrgDashboard();
  const provider = PROVIDERS[providerKey];
  return (
    <ItemPage testId="connector-setup">
      <ItemHeader
        back={{ href: getAddConnectorRoute(orgSlug), label: "添加连接器" }}
        logo={<ConnectorLogo name={provider.name} url={provider.url} size="md" />}
        title={`添加 ${provider.name}`}
      />
      <NativeProviderSettings
        providerKey={providerKey}
        clientProviderId={providerKey}
        create
        onSaved={(connectionId, name) => {
          toast({ title: `${name} 已就绪`, description: "每人使用自己的账户登录。" });
          router.push(getMcpConnectionRoute(orgSlug, connectionId));
        }}
        footer={({ save, saving, disabled, label }) => (
          <StepFooter note="每人使用自己的账户登录">
            <DenButton variant="secondary" disabled={saving} onClick={() => router.push(getMcpConnectionsRoute(orgSlug))}>取消</DenButton>
            <DenButton loading={saving} disabled={disabled} onClick={save} data-testid="native-provider-save">{label}</DenButton>
          </StepFooter>
        )}
      />
    </ItemPage>
  );
}
