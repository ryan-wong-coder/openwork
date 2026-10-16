import { t } from "@/i18n"
import type { DynamicToolUIPart, ToolUIPart } from "ai"
import {
  isApplyPatchToolPart,
  isBashToolPart,
  isEditToolPart,
  isGlobToolPart,
  isGrepToolPart,
  isLspToolPart,
  isQuestionToolPart,
  isReadToolPart,
  isSkillToolPart,
  isTaskToolPart,
  isTodoWriteToolPart,
  isWebFetchToolPart,
  isWebSearchToolPart,
  isWriteToolPart,
} from "./build-in-tools"
import { parseFilename, truncateText } from "../components/tools/path"

type AnyToolPart = ToolUIPart | DynamicToolUIPart

export function isToolPartInFlight(part: AnyToolPart): boolean {
  return part.state === "input-streaming" || part.state === "input-available"
}

function hostnameOf(url: string | undefined): string | undefined {
  if (!url) {
    return undefined
  }
  try {
    return new URL(url).hostname
  } catch {
    return undefined
  }
}

/**
 * Human-readable "what is this tool doing" label. Safe against partial
 * streamed input (fields may be missing despite the type contract).
 */
export function getToolActivityLabel(part: AnyToolPart): string {
  if (isBashToolPart(part)) {
    const description = part.input?.description?.trim()
    return description ? truncateText(description, 64) : t("ui.running_command")
  }
  if (isReadToolPart(part)) {
    return t("ui.reading_file", { name: parseFilename(part.input?.filePath) })
  }
  if (isEditToolPart(part)) {
    return t("ui.editing_file", { name: parseFilename(part.input?.filePath) })
  }
  if (isWriteToolPart(part)) {
    return t("ui.writing_file", { name: parseFilename(part.input?.filePath) })
  }
  if (isApplyPatchToolPart(part)) {
    return t("ui.applying_changes")
  }
  if (isGrepToolPart(part) || isGlobToolPart(part)) {
    const pattern = part.input?.pattern?.trim()
    return pattern
      ? t("ui.searching_pattern", { pattern: truncateText(pattern, 44) })
      : t("ui.searching_files")
  }
  if (isLspToolPart(part)) {
    return t("ui.inspecting_file", { name: parseFilename(part.input?.filePath) })
  }
  if (isSkillToolPart(part)) {
    const name = part.input?.name?.trim()
    return name ? t("ui.loading_named_skill", { name }) : t("ui.loading_skill")
  }
  if (isTodoWriteToolPart(part)) {
    return t("ui.updating_plan")
  }
  if (isWebFetchToolPart(part)) {
    const host = hostnameOf(part.input?.url)
    return host ? t("ui.reading_host", { host }) : t("ui.fetching_page")
  }
  if (isWebSearchToolPart(part)) {
    const query = part.input?.query?.trim()
    return query
      ? t("ui.web_search_query", { query: truncateText(query, 44) })
      : t("ui.searching_web")
  }
  if (isQuestionToolPart(part)) {
    return t("ui.asking_question")
  }
  if (isTaskToolPart(part)) {
    const description = part.input?.description?.trim()
    return description
      ? t("ui.agent_task_description", { description: truncateText(description, 56) })
      : t("ui.running_agent")
  }
  if (part.type === "dynamic-tool") {
    return t("ui.running_tool", { name: part.toolName.replace(/[_-]+/g, " ") })
  }
  return t("ui.working")
}
