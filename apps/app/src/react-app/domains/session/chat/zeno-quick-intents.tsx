/** @jsxImportSource react */
import { Code2, FileText, Image } from "lucide-react";
import { t } from "@/i18n";
import { Button } from "@/components/ui/button";
import { ZenoMascot } from "@/components/brand/zeno-brand";

export function ZenoGreeting({ pose = "welcome" }: { pose?: "welcome" | "thinking" }) {
  return <div className="zeno-greeting">
    <ZenoMascot className="zeno-greeting-mascot" pose={pose} loading="eager" />
    <h2>{t("zeno.greeting")}</h2>
  </div>;
}

export { insertZenoIntent } from "./zeno-intent-draft";

export function ZenoQuickIntents({ onPick, disabled = false }: { onPick: (prompt: string) => void; disabled?: boolean }) {
  const intents = [
    { id: "files", icon: FileText, title: t("zeno.intent_files"), prompt: t("zeno.prompt_files") },
    { id: "code", icon: Code2, title: t("zeno.intent_code"), prompt: t("zeno.prompt_code") },
    { id: "image", icon: Image, title: t("zeno.intent_image"), prompt: t("zeno.prompt_image") },
  ];
  return <div className="zeno-quick-intents" aria-label={t("zeno.quick_intents")}>
    {intents.map(({ id, icon: Icon, title, prompt }) => <Button
      key={id}
      type="button"
      variant="ghost"
      className="zeno-intent"
      data-zeno-intent={id}
      disabled={disabled}
      onClick={() => onPick(prompt)}
    ><Icon className="size-4" strokeWidth={1.5} aria-hidden="true" /><span>{title}</span></Button>)}
  </div>;
}
