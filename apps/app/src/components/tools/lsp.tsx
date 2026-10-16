"use client"

import { t } from "@/i18n";

import { Tool } from "@/components/ui/tool"
import type { LspInput, LspToolPart } from "@/lib/build-in-tools"
import { parseFilename, toolDisplayTitle } from "@/components/tools/path"

interface LspToolProps {
  part: LspToolPart
}

const lspOperationLabels = (): Record<LspInput["operation"], string> => ({
  goToDefinition: t("ui.go_to_definition"),
  findReferences: t("ui.find_references"),
  hover: t("ui.hover"),
  documentSymbol: t("ui.document_symbols"),
  workspaceSymbol: t("ui.workspace_symbols"),
  goToImplementation: t("ui.go_to_implementation"),
  prepareCallHierarchy: t("ui.prepare_call_hierarchy"),
  incomingCalls: t("ui.incoming_calls"),
  outgoingCalls: t("ui.outgoing_calls"),
})

function getLspToolTitle(part: LspToolPart): string | null {
  const filename = parseFilename(part.input.filePath)
  const operation = lspOperationLabels()[part.input.operation]

  if (part.state === "output-error") {
    return t("ui.file_operation_attempted", { operation, filename })
  }

  if (part.state !== "output-available") {
    return null
  }

  return t("ui.file_operation", { operation, filename })
}

function getLspToolDetail(part: LspToolPart): string | undefined {
  const line = part.input.line
  const character = part.input.character
  const query = part.input.query?.trim()

  const location = `L${line}:${character}`
  if (query) {
    return `${location} · ${query}`
  }

  return location
}

export function LspTool({ part }: LspToolProps) {
  return (
    <Tool
      toolPart={part}
      title={toolDisplayTitle(getLspToolTitle(part), getLspToolDetail(part))}
    />
  )
}
