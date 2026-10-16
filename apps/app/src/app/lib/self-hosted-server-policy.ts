export type SelfHostedServerPolicy = {
  appOrigin?: string;
  configuredUrls?: readonly string[];
};

function parsedServerUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) return null;
    const host = url.hostname.toLowerCase().replace(/\.$/, "");
    if (["openworklabs.com", "openwork.software"].some((domain) => host === domain || host.endsWith(`.${domain}`))) return null;
    return url;
  } catch {
    return null;
  }
}

/** Self-hosted clients trust their own origin and explicit operator endpoints, not old cloud targets. */
export function selfHostedServerAllowed(value: string, policy: SelfHostedServerPolicy = {}): boolean {
  const url = parsedServerUrl(value);
  if (!url) return false;
  if (url.hostname === "localhost" || url.hostname === "[::1]" || /^127(?:\.\d{1,3}){3}$/.test(url.hostname)) return true;
  const app = policy.appOrigin ? parsedServerUrl(policy.appOrigin) : null;
  if (app?.origin === url.origin) return true;
  return (policy.configuredUrls ?? []).some((configured) => {
    const base = parsedServerUrl(configured);
    if (!base || base.origin !== url.origin) return false;
    const prefix = base.pathname.replace(/\/+$/, "");
    return !prefix || url.pathname === prefix || url.pathname.startsWith(`${prefix}/`);
  });
}

export function configuredSelfHostedUrls(): string[] {
  const values = [import.meta.env?.VITE_OPENWORK_URL, import.meta.env?.VITE_OPENCODE_URL];
  return values.flatMap((value) => {
    if (typeof value !== "string" || !value.trim()) return [];
    try {
      const base = typeof window === "undefined" ? undefined : window.location.origin;
      return [new URL(value.trim(), base).href];
    } catch {
      return [];
    }
  });
}
