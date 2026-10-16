"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { composeSkillMarkdown, parseSkillMarkdown } from "@openwork-ee/utils";
import { getErrorMessage, getRequestError, requestJson } from "../../_lib/den-flow";
import { useOrgDashboard } from "../_providers/org-dashboard-provider";
import { pluginQueryKeys } from "./plugin-data";

export type DenSkill = {
  id: string;
  name: string;
  description: string;
  body: string;
  rawSourceText: string;
  updatedAt: string;
};

export type SkillDraft = {
  name: string;
  description: string;
  body: string;
};

export const skillQueryKeys = {
  all: ["skills"],
  detail: (organizationId: string, pluginId: string, skillId: string) => ["skills", organizationId, pluginId, "detail", skillId],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

export function skillSourceFromDraft(draft: SkillDraft): string {
  return composeSkillMarkdown(draft.name, draft.description, draft.body);
}

export function createSkillPayload(pluginId: string, draft: SkillDraft) {
  return {
    type: "skill",
    sourceMode: "cloud",
    pluginIds: [pluginId],
    input: { rawSourceText: skillSourceFromDraft(draft) },
  };
}

export function parseSkillPayload(entry: unknown): DenSkill | null {
  if (!isRecord(entry) || entry.objectType !== "skill" || !isRecord(entry.latestVersion)) {
    return null;
  }

  const id = stringValue(entry.id);
  const title = stringValue(entry.title);
  const updatedAt = stringValue(entry.updatedAt);
  const rawSourceText = stringValue(entry.latestVersion.rawSourceText);
  if (!id || !title || !updatedAt || !rawSourceText) {
    return null;
  }

  const parsed = parseSkillMarkdown(rawSourceText);
  return {
    id,
    name: parsed.name.trim() || title,
    description: parsed.description.trim() || stringValue(entry.description)?.trim() || "",
    body: parsed.body.trim(),
    rawSourceText,
    updatedAt,
  };
}

function parseSkillResponse(payload: unknown): DenSkill | null {
  return isRecord(payload) ? parseSkillPayload(payload.item) : null;
}

export function useSkill(pluginId: string, skillId: string) {
  const { orgId } = useOrgDashboard();
  const organizationId = orgId ?? "none";

  return useQuery({
    enabled: Boolean(orgId && pluginId && skillId),
    queryKey: skillQueryKeys.detail(organizationId, pluginId, skillId),
    queryFn: async (): Promise<DenSkill> => {
      const encodedSkillId = encodeURIComponent(skillId);
      const [{ response, payload }, membershipResult] = await Promise.all([
        requestJson(`/v1/config-objects/${encodedSkillId}`, { method: "GET" }, 15000),
        requestJson(`/v1/config-objects/${encodedSkillId}/plugins`, { method: "GET" }, 15000),
      ]);
      if (!response.ok) {
        throw new Error(getErrorMessage(payload, `无法加载技能（${response.status}）。`));
      }
      if (!membershipResult.response.ok) {
        throw new Error(getErrorMessage(membershipResult.payload, `无法验证技能所属插件（${membershipResult.response.status}）。`));
      }
      const belongsToPlugin = isRecord(membershipResult.payload)
        && Array.isArray(membershipResult.payload.items)
        && membershipResult.payload.items.some((entry) => (
          isRecord(entry) && entry.pluginId === pluginId && entry.removedAt === null
        ));
      if (!belongsToPlugin) {
        throw new Error("此技能不属于当前插件。");
      }
      const skill = parseSkillResponse(payload);
      if (!skill) {
        throw new Error("技能详情响应不完整，请重试。");
      }
      return skill;
    },
  });
}

export function useCreateSkill(pluginId: string) {
  const queryClient = useQueryClient();
  const { runReauthableAction } = useOrgDashboard();

  return useMutation({
    mutationFn: async (draft: SkillDraft): Promise<DenSkill> => {
      const result: { skill?: DenSkill } = {};
      await runReauthableAction("create-skill", async () => {
        const { response, payload } = await requestJson(
          "/v1/config-objects",
          {
            method: "POST",
            body: JSON.stringify(createSkillPayload(pluginId, draft)),
          },
          15000,
        );
        if (!response.ok) {
          throw getRequestError(payload, response, `无法创建技能（${response.status}）。`);
        }
        const skill = parseSkillResponse(payload);
        if (!skill) {
          throw new Error("技能创建响应不完整，请重试。");
        }
        result.skill = skill;
      });
      if (!result.skill) throw new Error("技能保存响应不完整，请重试。");
      return result.skill;
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: skillQueryKeys.all }),
        queryClient.invalidateQueries({ queryKey: pluginQueryKeys.detail(pluginId) }),
      ]);
    },
  });
}

export function useUpdateSkill(pluginId: string) {
  const queryClient = useQueryClient();
  const { runReauthableAction } = useOrgDashboard();

  return useMutation({
    mutationFn: async (input: { skillId: string; draft: SkillDraft }): Promise<DenSkill> => {
      const result: { skill?: DenSkill } = {};
      await runReauthableAction("update-skill", async () => {
        const { response, payload } = await requestJson(
          `/v1/config-objects/${encodeURIComponent(input.skillId)}/versions`,
          {
            method: "POST",
            body: JSON.stringify({
              input: { rawSourceText: skillSourceFromDraft(input.draft) },
              reason: "从 Den 网页端更新",
            }),
          },
          15000,
        );
        if (!response.ok) {
          throw getRequestError(payload, response, `无法保存技能（${response.status}）。`);
        }
        const skill = parseSkillResponse(payload);
        if (!skill) {
          throw new Error("技能更新响应不完整，请重试。");
        }
        result.skill = skill;
      });
      if (!result.skill) throw new Error("技能保存响应不完整，请重试。");
      return result.skill;
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: skillQueryKeys.all }),
        queryClient.invalidateQueries({ queryKey: pluginQueryKeys.detail(pluginId) }),
      ]);
    },
  });
}

export function useDeleteSkill(pluginId: string) {
  const queryClient = useQueryClient();
  const { runReauthableAction } = useOrgDashboard();

  return useMutation({
    mutationFn: async (skillId: string): Promise<string> => {
      await runReauthableAction("delete-skill", async () => {
        const { response, payload } = await requestJson(
          `/v1/config-objects/${encodeURIComponent(skillId)}/delete`,
          { method: "POST" },
          15000,
        );
        if (!response.ok) {
          throw getRequestError(payload, response, `无法删除技能（${response.status}）。`);
        }
      });
      return skillId;
    },
    onSuccess: async () => {
      await queryClient.cancelQueries({ queryKey: skillQueryKeys.all });
      queryClient.removeQueries({ queryKey: skillQueryKeys.all });
      await queryClient.invalidateQueries({ queryKey: pluginQueryKeys.detail(pluginId) });
    },
  });
}
