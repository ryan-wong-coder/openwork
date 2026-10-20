import { MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

export function ExerciseActions({ name, disabled, onUp, onDown, onReplace, onRemove, keepCompleted = false }: { name: string; disabled?: boolean; onUp?: () => void; onDown?: () => void; onReplace: () => void; onRemove: () => void; keepCompleted?: boolean }) {
  return <DropdownMenu><DropdownMenuTrigger render={<Button type="button" variant="ghost" size="icon-sm" disabled={disabled} aria-label={`${name}动作选项`} />}><MoreHorizontal strokeWidth={1.5} /></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem disabled={!onUp} onClick={onUp}>上移动作</DropdownMenuItem><DropdownMenuItem disabled={!onDown} onClick={onDown}>下移动作</DropdownMenuItem><DropdownMenuItem onClick={onReplace}>替换动作</DropdownMenuItem><DropdownMenuItem onClick={onRemove}>{keepCompleted ? "保留完成组并结束动作" : "移除动作"}</DropdownMenuItem></DropdownMenuContent></DropdownMenu>;
}
