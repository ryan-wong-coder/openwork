"use client"

import { t } from "@/i18n";

import { Tool } from "@/components/ui/tool"
import type { ApplyPatchToolPart } from "@/lib/build-in-tools"

interface ApplyPatchToolProps {
  part: ApplyPatchToolPart
}

function getApplyPatchToolTitle(part: ApplyPatchToolPart): string | null {
  if (part.state === "output-error") {
    return t("ui.apply_patch_attempted")
  }

  if (part.state !== "output-available") {
    return null
  }

  return t("ui.apply_patch")
}

export function ApplyPatchTool({ part }: ApplyPatchToolProps) {
  return (
    <Tool toolPart={part} title={getApplyPatchToolTitle(part) ?? undefined} />
  )
}
