"use client"

import { t } from "@/i18n";

import { Tool } from "@/components/ui/tool"
import type { SkillToolPart } from "@/lib/build-in-tools"

interface SkillToolProps {
  part: SkillToolPart
}

function getSkillToolTitle(part: SkillToolPart): string | null {
  const name = part.input?.name?.trim() ?? ""

  if (part.state === "output-error") {
    return name ? t("ui.skill_failed_named", { name }) : t("ui.couldn_t_use_a_skill")
  }

  if (part.state !== "output-available") {
    return null
  }

  return name ? t("ui.skill_using_named", { name }) : t("ui.using_a_skill")
}

export function SkillTool({ part }: SkillToolProps) {
  return <Tool toolPart={part} title={getSkillToolTitle(part) ?? undefined} />
}
