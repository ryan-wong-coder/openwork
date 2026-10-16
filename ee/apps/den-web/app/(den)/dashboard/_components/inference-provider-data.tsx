"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { GatewayAccessGrantWrite, GatewayCredentialSetWrite, GatewayModelGroupWrite } from "@openwork/types/den/gateway";
import { auditOperationHeaders, type AuditOperationContext } from "@openwork/types/den/audit";
import { getErrorMessage, getRequestError, requestJson } from "../../_lib/den-flow";
import { ORG_SCOPE_HEADER } from "../../_lib/org-scope";
import {
  buildMigrateFromLlmProviderBody,
  readInferenceProviderFromPayload,
  readInferenceProvidersFromPayload,
  readInferenceProviderDetails,
  type DenInferenceProviderDetails,
  type DenInferenceProvider,
  type InferenceProviderRequestBody,
} from "./inference-provider-request";

export function useOrgInferenceProviders(orgId: string | null) {
  const generation = useRef(0);
  const [inferenceProviders, setInferenceProviders] = useState<DenInferenceProvider[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadProviders = useCallback(async () => {
    const request = ++generation.current;
    if (!orgId) {
      setInferenceProviders([]);
      setBusy(false);
      setError("未找到组织。");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { response, payload } = await requestJson(`/v1/inference-providers?scope=manageable`, { method: "GET", headers: { [ORG_SCOPE_HEADER]: orgId } }, 15000);
      if (request !== generation.current) return;
      if (!response.ok) {
        throw new Error(getErrorMessage(payload, `无法加载网关提供商（${response.status}）。`));
      }
      setInferenceProviders(readInferenceProvidersFromPayload(payload));
    } catch (loadError) {
      if (request !== generation.current) return;
      setError(loadError instanceof Error ? loadError.message : "无法加载网关提供商，请重试。");
    } finally {
      if (request === generation.current) setBusy(false);
    }
  }, [orgId]);

  useEffect(() => {
    void loadProviders();
    return () => { generation.current += 1; };
  }, [loadProviders]);

  return { inferenceProviders, busy, error, reloadProviders: loadProviders };
}

/** One provider with its access grants and credential list (no secret values). */
export function useInferenceProvider(orgId: string | null, inferenceProviderId: string | null) {
  const generation = useRef(0);
  const [provider, setProvider] = useState<DenInferenceProviderDetails | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const request = ++generation.current;
    if (!orgId || !inferenceProviderId) {
      setProvider(null);
      setBusy(false);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { response, payload } = await requestJson(
        `/v1/inference-providers/${encodeURIComponent(inferenceProviderId)}`,
        { method: "GET", headers: { [ORG_SCOPE_HEADER]: orgId } },
        15000,
      );
      if (request !== generation.current) return;
      if (!response.ok) {
        throw new Error(getErrorMessage(payload, `无法加载提供商（${response.status}）。`));
      }
      const catalog = await requestJson(`/v1/inference-providers/${encodeURIComponent(inferenceProviderId)}/models`, { method: "GET", headers: { [ORG_SCOPE_HEADER]: orgId } }, 15000);
      if (request !== generation.current) return;
      if (!catalog.response.ok) throw new Error(getErrorMessage(catalog.payload, "无法加载已配置的目录模型，请重试。"));
      const next = readInferenceProviderDetails(payload, catalog.payload);
      if (!next) {
        throw new Error("服务器未返回有效的模型组、凭据集和访问规则。更新 API 后才可编辑权限矩阵。");
      }
      setProvider(next);
    } catch (loadError) {
      if (request !== generation.current) return;
      setProvider(null);
      setError(loadError instanceof Error ? loadError.message : "无法加载提供商，请重试。");
    } finally {
      if (request === generation.current) setBusy(false);
    }
  }, [orgId, inferenceProviderId]);

  useEffect(() => {
    void load();
    return () => { generation.current += 1; };
  }, [load]);

  return { provider, busy, error, reload: load };
}

export async function saveInferenceProvider(input: {
  inferenceProviderId: string | null;
  body: Partial<InferenceProviderRequestBody>;
  auditContext?: AuditOperationContext;
}): Promise<DenInferenceProvider> {
  const path = input.inferenceProviderId
    ? `/v1/inference-providers/${encodeURIComponent(input.inferenceProviderId)}`
    : `/v1/inference-providers`;
  const { response, payload } = await requestJson(
    path,
    { method: input.inferenceProviderId ? "PATCH" : "POST", body: JSON.stringify(input.body), headers: auditOperationHeaders(input.auditContext) },
    20000,
  );
  if (!response.ok) {
    throw getRequestError(payload, response, `无法保存网关提供商（${response.status}）。`);
  }
  const provider = readInferenceProviderFromPayload(payload);
  if (!provider) {
    throw new Error("提供商已保存，但未返回提供商信息，请刷新后重试。");
  }
  return provider;
}

type GatewayResourceWrite =
  | { resource: "model-groups"; body: GatewayModelGroupWrite }
  | { resource: "credential-sets"; body: GatewayCredentialSetWrite }
  | { resource: "access-grants"; body: GatewayAccessGrantWrite };

export async function saveGatewayResource(providerId: string, id: string | null, input: GatewayResourceWrite, auditContext?: AuditOperationContext) {
  const path = `/v1/inference-providers/${encodeURIComponent(providerId)}/${input.resource}${id ? `/${encodeURIComponent(id)}` : ""}`;
  const { response, payload } = await requestJson(path, {
    method: id ? "PATCH" : "POST", body: JSON.stringify(input.body), headers: auditOperationHeaders(auditContext),
  }, 20000);
  if (!response.ok) throw getRequestError(payload, response, `无法保存 ${input.resource}（${response.status}）。`);
}

export async function deleteGatewayResource(providerId: string, resource: GatewayResourceWrite["resource"], id: string, auditContext?: AuditOperationContext) {
  const { response, payload } = await requestJson(
    `/v1/inference-providers/${encodeURIComponent(providerId)}/${resource}/${encodeURIComponent(id)}`,
    { method: "DELETE", headers: auditOperationHeaders(auditContext) }, 20000,
  );
  if (!response.ok) throw getRequestError(payload, response, `无法删除 ${resource}（${response.status}）。`);
}

export async function deleteInferenceProvider(inferenceProviderId: string, auditContext?: AuditOperationContext) {
  const { response, payload } = await requestJson(
    `/v1/inference-providers/${encodeURIComponent(inferenceProviderId)}`,
    { method: "DELETE", headers: auditOperationHeaders(auditContext) },
    12000,
  );
  if (response.status !== 204 && !response.ok) {
    throw getRequestError(payload, response, `无法删除网关提供商（${response.status}）。`);
  }
}

/** Moves a models.dev BYOK provider to the gateway; returns the new gateway provider. */
export async function migrateLlmProviderToGateway(llmProviderId: string): Promise<DenInferenceProvider> {
  const { response, payload } = await requestJson(
    `/v1/inference-providers/migrate-from-llm-provider`,
    { method: "POST", body: JSON.stringify(buildMigrateFromLlmProviderBody(llmProviderId)) },
    20000,
  );
  if (!response.ok) {
    throw getRequestError(payload, response, `无法将提供商移至网关（${response.status}）。`);
  }
  const provider = readInferenceProviderFromPayload(payload);
  if (!provider) {
    throw new Error("提供商已迁移，但未返回网关提供商信息，请刷新后重试。");
  }
  return provider;
}
