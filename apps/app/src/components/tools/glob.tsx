"use client"

import { t } from "@/i18n";

import { Tool } from "@/components/ui/tool"
import type { GlobToolPart } from "@/lib/build-in-tools"
import { parseFilename, toolDisplayTitle, truncateText } from "@/components/tools/path"

interface GlobToolProps {
  part: GlobToolPart
}

function getGlobToolTitle(part: GlobToolPart): string | null {
  const pattern = part.input?.pattern?.trim() ?? ""

  if (part.state === "output-error") {
    return pattern
      ? t("ui.search_pattern_attempted", { pattern: truncateText(pattern, 44) })
      : t("ui.search_attempted")
  }

  if (part.state !== "output-available") {
    return null
  }

  return pattern ? t("ui.searched_pattern", { pattern: truncateText(pattern, 44) }) : t("ui.searched_code")
}

function getGlobToolDetail(part: GlobToolPart): string | undefined {
  const root = part.input?.path?.trim()
  if (!root) {
    return undefined
  }

  return t("ui.in_folder", { folder: parseFilename(root) })
}

export function GlobTool({ part }: GlobToolProps) {
  return (
    <Tool
      toolPart={part}
      title={toolDisplayTitle(getGlobToolTitle(part), getGlobToolDetail(part))}
    />
  )
}
