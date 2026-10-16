import type { DynamicToolUIPart } from "ai";
import { getCapabilityCallSentence } from "./capability-call";
import { t } from "../i18n";

function callAction(call: DynamicToolUIPart): string {
  const name = call.toolName.endsWith("_execute_capability") && typeof call.input === "object" && call.input !== null && "name" in call.input
    ? call.input.name : call.toolName;
  return typeof name === "string" ? name.split(/[.:/]/).at(-1) ?? "" : "";
}

/** A summary of the work, not a mirror of whichever child happened to run last. */
export function codeModeSummary(
  calls: DynamicToolUIPart[],
  options: {
    running: boolean;
    failed: boolean;
    serviceName: (call: DynamicToolUIPart) => string | null;
  },
): string {
  const failedCalls = calls.filter((call) => call.state === "output-error");
  // A finished script whose every call failed did not "look up" anything,
  // even when the engine reports the script itself as completed.
  const allFailed = !options.running && calls.length > 0 && failedCalls.length === calls.length;
  if (options.failed || allFailed) {
    // Name what failed when one call did ("Script on OpenWork Cloud failed").
    const only = failedCalls.length === 1 ? failedCalls[0] : undefined;
    const failure = only ? getCapabilityCallSentence(only, { connectionName: options.serviceName(only), includeQuery: false }).failure : undefined;
    return failure ?? t("capability.script.failure");
  }
  if (calls.length === 0) return t(options.running ? "capability.script.present" : "capability.script.past");

  const changes = calls.filter((call) => /(?:^|_)(create|save|add|send|post|update|edit|write|delete|remove|publish|move|rename)(?:_|[A-Z]|$)/i.test(callAction(call)));
  if (changes.length === 1) {
    const call = changes[0]!;
    const sentence = getCapabilityCallSentence(call, { connectionName: options.serviceName(call), includeQuery: false });
    const label = options.running && (call.state === "input-available" || call.state === "input-streaming") ? sentence.present : sentence.past;
    // A successful write is more informative than a later read. Don't report
    // success for a write the engine says failed.
    if (call.state !== "output-error") {
      const service = options.serviceName(call);
      const input = typeof call.input === "object" && call.input !== null ? call.input : null;
      const action = callAction(call);
      const creating = options.running && (call.state === "input-available" || call.state === "input-streaming");
      const serviceTail = service ? t("capability.service_suffix", { service }) : "";
      const body = input && "body" in input && typeof input.body === "object" && input.body !== null ? input.body : null;
      if (/(?:^|_)save_issue$/.test(action)) {
        const updating = body && "id" in body && typeof body.id === "string" && body.id.length > 0;
        return `${t(`capability.verb.${updating ? "update" : "create"}.${creating ? "present" : "past"}`, { target: t("capability.subject.issue") })}${serviceTail}`;
      }
      if (/(?:^|_)create_(issue|note|task|document)$/.test(action)) {
        const subject = action.split("_").at(-1);
        return `${t(`capability.verb.create.${creating ? "present" : "past"}`, { target: t(`capability.subject.${subject}`) })}${serviceTail}`;
      }
      return service && !label.includes(service) ? `${label}${serviceTail}` : label;
    }
  }

  const services = [...new Set(calls.map(options.serviceName).filter((name): name is string => Boolean(name)))];
  const names = services.length > 2 ? t("capability.services_others", { names: services.slice(0, 2).join(t("capability.list_separator")) })
    : services.join(t("capability.and_separator"));
  if (changes.length > 0) {
    const tense = options.running ? "present" : changes.every(call => call.state === "output-error") ? "attempted" : "past";
    return t(`capability.changes.${tense}`, { target: names || t("capability.connected_services") });
  }
  // A group of searches says so ("Searched Exa"), not a vague "Looked up".
  const allSearches = calls.length > 0 && calls.every((call) => {
    const action = callAction(call);
    return /(?:^|[-_])search(?:[-_]|$)/i.test(action) || /^search[A-Z]/.test(action);
  });
  if (allSearches && names) return t(`capability.verb.search.${options.running ? "present" : "past"}`, { target: names });
  return t(`capability.lookup.${options.running ? "present" : "past"}`, { target: names || t("capability.information") });
}
