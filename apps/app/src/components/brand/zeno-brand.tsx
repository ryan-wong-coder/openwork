/** @jsxImportSource react */
import mascot from "@/assets/zeno/mascot.webp";
import mascotThinking from "@/assets/zeno/mascot-thinking.webp";
import markPrimary from "@/assets/zeno/zeno-mark-primary.svg";
import markReverse from "@/assets/zeno/zeno-mark-reverse.svg";
import wordmarkPrimary from "@/assets/zeno/zeno-logo-primary.svg";
import wordmarkReverse from "@/assets/zeno/zeno-logo-reverse.svg";
import { cn } from "@/lib/utils";

type BrandProps = {
  className?: string;
  decorative?: boolean;
  title?: string;
};

function BrandArtwork({
  className,
  decorative = true,
  title = "泽诺 Zeno",
  primary,
  reverse,
}: BrandProps & { primary: string; reverse: string }) {
  return (
    <span className={cn("zeno-brand-artwork inline-grid shrink-0", className)} aria-hidden={decorative || undefined} role={decorative ? undefined : "img"} aria-label={decorative ? undefined : title}>
      <img className="zeno-brand-primary col-start-1 row-start-1 size-full object-contain" src={primary} alt="" draggable={false} />
      <img className="zeno-brand-reverse col-start-1 row-start-1 hidden size-full object-contain" src={reverse} alt="" aria-hidden="true" draggable={false} />
    </span>
  );
}

export function ZenoMark(props: BrandProps) {
  return <BrandArtwork {...props} className={cn("size-6", props.className)} primary={markPrimary} reverse={markReverse} />;
}

/** Original full lockup: symbol, Latin wordmark and Chinese product name. */
export function ZenoWordmark(props: BrandProps) {
  return <BrandArtwork {...props} className={cn("h-7 w-20", props.className)} primary={wordmarkPrimary} reverse={wordmarkReverse} />;
}

export function ZenoMascot({
  className,
  decorative = true,
  alt = "泽诺",
  loading = "lazy",
  pose = "welcome",
}: {
  className?: string;
  decorative?: boolean;
  alt?: string;
  loading?: "eager" | "lazy";
  /** Decorative posture, independent of execution or model status. */
  pose?: "welcome" | "thinking";
}) {
  return <img className={cn("zeno-mascot object-contain", className)} src={pose === "thinking" ? mascotThinking : mascot} alt={decorative ? "" : alt} aria-hidden={decorative || undefined} loading={loading} decoding="async" draggable={false} width={502} height={768} />;
}
