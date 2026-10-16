import { isZenoInterfaceEnabled } from "@/app/lib/zeno-identity";
import { getComposerDraft, useComposerStateStore } from "../surface/composer-state-store";

/** Keep anything the person has already typed, including inline attachment tokens. */
export function insertZenoIntent(draft: string, intent: string): string {
  if (!draft.trim()) return intent;
  return `${draft}${draft.endsWith("\n") ? "" : "\n"}${intent}`;
}

/** Suggestions read the current session store at the click, never a stale transcript snapshot. */
export function sessionSuggestionDraft(sessionId: string, intent: string): string {
  if (!isZenoInterfaceEnabled()) return intent;
  return insertZenoIntent(getComposerDraft(useComposerStateStore.getState(), sessionId), intent);
}
