"use client"

import { t } from "@/i18n";

import { Tool } from "@/components/ui/tool"
import type { EditToolPart } from "@/lib/build-in-tools"
import { parseFilename } from "@/components/tools/path"

interface EditToolProps {
  part: EditToolPart
}

function getEditToolTitle(part: EditToolPart): string | null {
  const filename = parseFilename(part.input.filePath)

  if (part.state === "output-error") {
    return t("ui.update_file_attempted", { filename })
  }

  if (part.state !== "output-available") {
    return null
  }

  return t("ui.updated_file", { filename })
}

export function EditTool({ part }: EditToolProps) {
  return <Tool toolPart={part} title={getEditToolTitle(part) ?? undefined} />
}
