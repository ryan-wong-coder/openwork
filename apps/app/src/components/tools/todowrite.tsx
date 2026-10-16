"use client"

import { t } from "@/i18n";

import { Tool } from "@/components/ui/tool"
import type { TodoWriteToolPart } from "@/lib/build-in-tools"

interface TodoWriteToolProps {
  part: TodoWriteToolPart
}

function getTodoWriteToolTitle(part: TodoWriteToolPart): string | null {
  // Streamed/interrupted tool calls can surface with partial input despite
  // the type contract; an unguarded read here white-screened the whole app.
  const count = part.input?.todos?.length ?? 0

  if (part.state === "output-error") {
    return t("ui.update_todo_list_attempted")
  }

  if (part.state !== "output-available") {
    return null
  }

  return count > 0 ? t("ui.update_todo_count", { count }) : t("ui.update_todo_list")
}

export function TodoWriteTool({ part }: TodoWriteToolProps) {
  return (
    <Tool toolPart={part} title={getTodoWriteToolTitle(part) ?? undefined} />
  )
}
