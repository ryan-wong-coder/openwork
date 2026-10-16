"use client";

import { ChevronRight, LoaderCircle, LogIn } from "lucide-react";
import { DenBrandMark } from "../../_components/ui/brand-mark";
import { DenButton } from "../../_components/ui/button";
import { getLibraryModelRoute, getLibraryRoute } from "../../_lib/den-org";
import { useOrgDashboard } from "../_providers/org-dashboard-provider";
import { ItemHeader, ItemPage, SectionTitle } from "./item-header";
import { ItemMenu, ItemPanel, ItemRow } from "./item-list";
import {
  type LibraryModelProvider,
  modelCount,
  modelNamesSummary,
  signInBrand,
} from "./library-models";
import { useLibraryModels, useModelSignIn } from "./library-models-data";

type ModelSignIn = ReturnType<typeof useModelSignIn>;

export function ProviderLogo({ provider, size = "sm" }: { provider: Pick<LibraryModelProvider, "name" | "iconSlug">; size?: "sm" | "lg" }) {
  return (
    <DenBrandMark
      name={provider.name}
      simpleIconSlug={provider.iconSlug}
      className={size === "lg" ? "h-10 w-10 rounded-xl border-gray-200" : "h-8 w-8 rounded-[7px] border-gray-200"}
      imageClassName={size === "lg" ? "h-5 w-5" : "h-[18px] w-[18px]"}
    />
  );
}

/** One provider in My Library, with the one thing the person can do about it on the right. */
export function LibraryModelRow({ provider, signIn }: { provider: LibraryModelProvider; signIn: ModelSignIn }) {
  const { orgSlug } = useOrgDashboard();
  const waiting = signIn.waitingFor === provider.id;
  const failure = signIn.failureFor(provider.id);
  const action = provider.state === "blocked" ? null
    : waiting ? <DenButton variant="ghost" size="xs" onClick={signIn.cancel}>取消</DenButton>
      : provider.state === "needs_signin" ? (
        <DenButton variant="secondary" size="xs" icon={LogIn} aria-label={failure ? "重试" : "登录"} className="size-7 p-0" onClick={() => void signIn.signIn(provider)} />
      ) : <ChevronRight className="h-4 w-4 text-gray-400" aria-hidden />;
  return (
    <div data-library-item={provider.name} data-library-kind="model" data-model-state={provider.state} title={modelNamesSummary(provider.models)}>
      <ItemRow compact href={getLibraryModelRoute(orgSlug, provider.id)} logo={<ProviderLogo provider={provider} />} title={provider.name} description={provider.state === "blocked" ? "管理员需要完成配置" : waiting ? "在浏览器中完成登录" : failure ?? modelNamesSummary(provider.models)} status={provider.state === "blocked" ? "设置" : provider.state === "needs_signin" || waiting ? "登录" : "已就绪"} action={action ?? <span />} />
    </div>
  );
}

function stateLine(provider: LibraryModelProvider, waiting: boolean): { text: string; dot: string } {
  if (provider.state === "blocked") return { text: "正在等待管理员完成配置。", dot: "bg-gray-300" };
  if (waiting) return { text: "请在浏览器中完成登录。", dot: "bg-gray-300" };
  if (provider.account) return { text: `已以 ${provider.account} 身份登录`, dot: "bg-emerald-600" };
  if (provider.memberSets.length > 0) return { text: `尚未登录，使用你自己的 ${signInBrand(provider)} 账户。`, dot: "bg-gray-300" };
  return { text: "由组织统一登录。", dot: "bg-emerald-600" };
}

/** A provider's page in My Library: which account is in use and every model it gives the person. */
export function LibraryModelProviderScreen({ providerId }: { providerId: string }) {
  const { orgSlug } = useOrgDashboard();
  const models = useLibraryModels();
  const signIn = useModelSignIn();
  const back = { href: `${getLibraryRoute(orgSlug)}?show=models`, label: "我的资源库" };
  const provider = models.data?.find((entry) => entry.id === providerId) ?? null;

  if (!provider && models.isLoading) return <ItemPage><ItemHeader back={back} title="正在加载…" /></ItemPage>;
  if (!provider && models.error) return <ItemPage><ItemHeader back={back} title="加载失败" description="请重新加载页面后重试。" /></ItemPage>;
  if (!provider) return <ItemPage><ItemHeader back={back} title="不在你的资源库中" description="组织可能已停止向你提供这些模型。" /></ItemPage>;

  const waiting = signIn.waitingFor === provider.id;
  const failure = signIn.failureFor(provider.id);
  const line = stateLine(provider, waiting);
  const brand = signInBrand(provider);
  const signedIn = provider.memberSets.some((set) => set.hasCredential);
  const canSignIn = provider.signInSet !== null && provider.state !== "blocked";

  const actions = waiting
    ? <DenButton variant="secondary" onClick={signIn.cancel}>取消</DenButton>
    : signedIn
      ? (
        <ItemMenu
          size="md"
          label={`${provider.name} 的更多操作`}
          entries={[
            ...(canSignIn ? [{ label: "切换账户", onSelect: () => void signIn.signIn(provider) }] : []),
            {
              label: "退出登录",
              onSelect: () => signIn.signOut(provider),
              confirm: {
                title: `退出 ${provider.name}？`,
                description: `重新登录前无法使用这些模型。${brand} 也可能使使用相同 ${brand} 账户的其他 OpenWork 连接退出登录。`,
                action: "Sign out",
              },
            },
          ]}
        />
      )
      : canSignIn ? <DenButton onClick={() => void signIn.signIn(provider)}>{`使用 ${brand} 登录`}</DenButton> : null;

  return (
    <ItemPage testId="library-model-provider">
      <ItemHeader
        back={back}
        logo={<ProviderLogo provider={provider} size="lg" />}
        title={provider.name}
        description={(
          <span className="inline-flex items-center gap-2" data-testid="model-provider-state">
            {waiting ? <LoaderCircle className="h-3 w-3 animate-spin text-gray-400" aria-hidden /> : <span className={`h-1.5 w-1.5 rounded-full ${line.dot}`} aria-hidden />}
            {line.text}
          </span>
        )}
        actions={actions}
      />
      {failure ? (
        <p className="-mt-3 text-[13px] leading-5 text-gray-600" role="status">
          {failure}{" "}
          <button type="button" className="font-medium text-gray-900 underline-offset-2 hover:underline" onClick={() => void signIn.signIn(provider)}>重试</button>
        </p>
      ) : null}
      <section className="flex flex-col gap-2.5" data-testid="model-provider-models">
        <SectionTitle title={modelCount(provider.models.length)} />
        <ItemPanel>
          {provider.models.length === 0 ? <p className="px-5 py-4 text-[13px] text-gray-500">暂无模型。</p> : null}
          {provider.models.map((model) => (
            <div key={model.name} className="flex items-center gap-3 px-5 py-3" data-testid="model-provider-model">
              <DenBrandMark name={model.vendor} simpleIconSlug={model.vendorIconSlug} className="h-6 w-6 rounded-md border-gray-200" imageClassName="h-3.5 w-3.5" />
              <span className="min-w-0 flex-1 truncate text-[14px] font-medium leading-5 text-gray-900">{model.name}</span>
              <span className="shrink-0 text-[12px] leading-4 text-gray-500">{model.vendor}</span>
            </div>
          ))}
        </ItemPanel>
      </section>
      <details className="group rounded-2xl border border-gray-100 bg-white" data-testid="model-provider-technical">
        <summary className="flex cursor-pointer list-none items-center justify-between px-5 py-3 text-[13px] font-medium text-gray-700 [&::-webkit-details-marker]:hidden">
          技术详情
          <ChevronRight className="h-4 w-4 text-gray-400 transition-transform group-open:rotate-90" aria-hidden />
        </summary>
        <dl className="flex flex-col gap-2 border-t border-gray-100 px-5 py-4 text-[12px] leading-4 text-gray-500">
          <div className="flex justify-between gap-4"><dt>提供商</dt><dd className="text-gray-700">{provider.providerKey}</dd></div>
          {provider.modelGroups.length > 0 ? <div className="flex justify-between gap-4"><dt>模型组</dt><dd className="text-gray-700">{provider.modelGroups.join(", ")}</dd></div> : null}
          {provider.memberSets.map((set) => (
            <div key={set.credentialSetId} className="flex justify-between gap-4">
              <dt>凭据集</dt>
              <dd className="text-gray-700">{set.name}: {set.ready ? "已就绪" : set.configurationRequired ? "需要管理员配置" : !set.hasAccess ? "访问权限已移除" : "需要你登录"}</dd>
            </div>
          ))}
          {provider.memberSets.length > 0 ? <p className="pt-1">{`登录使用 ${brand} OAuth。令牌保存在 OpenWork 服务器上，不会在此显示。`}</p> : null}
        </dl>
      </details>
    </ItemPage>
  );
}
