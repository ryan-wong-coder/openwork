import { afterEach, expect, mock, test } from "bun:test";
let enabled = true;
mock.module("../src/app/lib/zeno-identity", () => ({ isZenoInterfaceEnabled: () => enabled }));
const { useComposerStateStore } = await import("../src/react-app/domains/session/surface/composer-state-store");
const { sessionSuggestionDraft } = await import("../src/react-app/domains/session/chat/zeno-intent-draft");

afterEach(() => { useComposerStateStore.getState().clearSession("fixture"); enabled = true; });

test("an empty-session intention preserves the current draft, inline attachment, and pasted-text tokens", () => {
  useComposerStateStore.getState().setDraft("fixture", "Current note [attachment document] [pasted text 1]");
  expect(sessionSuggestionDraft("fixture", "Create an image")).toBe("Current note [attachment document] [pasted text 1]\nCreate an image");
  // A newer keystroke after the list rendered must also survive the click.
  useComposerStateStore.getState().setDraft("fixture", "Newer note [attachment document]");
  expect(sessionSuggestionDraft("fixture", "Organize files")).toBe("Newer note [attachment document]\nOrganize files");
  expect(useComposerStateStore.getState().sessions.fixture?.draft).toBe("Newer note [attachment document]");
});

test("turning the interface off preserves the original suggestion replacement", () => {
  useComposerStateStore.getState().setDraft("fixture", "Original");
  enabled = false;
  expect(sessionSuggestionDraft("fixture", "Suggestion")).toBe("Suggestion");
});
