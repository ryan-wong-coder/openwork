import type { RefObject } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { t } from "@/i18n";

/** Imports go to the configured workspace server; no catalog or account is involved. */
export function LocalLibraryActions(props: {
  disabled: boolean;
  skillFileInput: RefObject<HTMLInputElement | null>;
  onAddMcp: () => void;
  onInstallPlugin?: () => void;
  onImportSkillText?: (content: string, filename: string) => Promise<void>;
  onImportError: (message: string | null) => void;
}) {
  return <>
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button disabled={props.disabled} aria-label={t("extensions.add_to_library")}><Plus className="size-4" />{t("common.add")}</Button>} />
      <DropdownMenuContent align="end">
        <DropdownMenuItem disabled={props.disabled} onClick={props.onAddMcp}>{t("extensions.add_workspace_mcp")}</DropdownMenuItem>
        {props.onImportSkillText ? <DropdownMenuItem disabled={props.disabled} onClick={() => props.skillFileInput.current?.click()}>{t("zeno.library.import_skill")}</DropdownMenuItem> : null}
        {props.onInstallPlugin ? <DropdownMenuItem disabled={props.disabled} onClick={props.onInstallPlugin}>{t("zeno.library.install_plugin")}</DropdownMenuItem> : null}
      </DropdownMenuContent>
    </DropdownMenu>
    <input ref={props.skillFileInput} type="file" accept=".md,text/markdown" hidden disabled={props.disabled} aria-label={t("zeno.library.import_skill")} onChange={(event) => {
      const file = event.currentTarget.files?.[0];
      event.currentTarget.value = "";
      if (props.disabled || !file || !props.onImportSkillText) return;
      if (!/\.md$/i.test(file.name) || file.size === 0 || file.size >= 256 * 1024) {
        props.onImportError(t("zeno.library.invalid_skill_file"));
        return;
      }
      props.onImportError(null);
      void file.text().then((content) => props.onImportSkillText?.(content, file.name)).catch((cause: unknown) => {
        props.onImportError(cause instanceof Error ? cause.message : t("zeno.library.import_failed"));
      });
    }} />
  </>;
}
