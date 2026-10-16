"use client";

import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { getErrorMessage, requestJson } from "../../_lib/den-flow";
import { ORG_SCOPE_HEADER } from "../../_lib/org-scope";
import { asInferenceProvider } from "./inference-provider-request";

const providerListSchema = z.object({ inferenceProviders: z.array(z.unknown()) });

export function useGatewayAccessProviders(orgId: string, enabled = true) {
  return useQuery({
    queryKey: ["gateway-subject-access", orgId],
    enabled,
    retry: false,
    staleTime: 0,
    gcTime: 0,
    queryFn: async ({ signal }) => {
      const { response, payload } = await requestJson("/v1/inference-providers?scope=manageable", {
        method: "GET", headers: { [ORG_SCOPE_HEADER]: orgId }, cache: "no-store", signal,
      }, 15000);
      if (!response.ok) throw new Error(getErrorMessage(payload, "无法加载提供商访问权限，请刷新后重试。"));
      const result = providerListSchema.safeParse(payload);
      if (!result.success) throw new Error("无法验证提供商访问权限，请刷新后重试。");
      return result.data.inferenceProviders.map((value) => {
        let provider: ReturnType<typeof asInferenceProvider>;
        try {
          provider = asInferenceProvider(value);
        } catch {
          throw new Error("提供商访问权限定义不可用，请刷新或联系管理员更新网关 API。");
        }
        if (!provider || !provider.modelGroups || !provider.credentialSets || !provider.accessGrants) {
          throw new Error("提供商访问权限定义不可用，请刷新或联系管理员更新网关 API。");
        }
        return { ...provider, modelGroups: provider.modelGroups, credentialSets: provider.credentialSets, accessGrants: provider.accessGrants };
      });
    },
  });
}

export type GatewayAccessProvider = NonNullable<ReturnType<typeof useGatewayAccessProviders>["data"]>[number];
