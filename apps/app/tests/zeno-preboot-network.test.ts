import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const beacon = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]!).find((source) => source.includes("var dsn ="));
if (!beacon) throw new Error("Missing pre-boot monitoring script");

function boot(profile: string, requireSignin = "") {
  const requests: string[] = [];
  const listeners: Record<string, (event: object) => void> = {};
  const script = beacon!.replaceAll("%VITE_OPENWORK_DEPLOYMENT%", "web")
    .replaceAll("%VITE_OPENWORK_SENTRY_DSN%", "https://public@monitor.example.test/1")
    .replaceAll("%VITE_OPENWORK_CLIENT_PROFILE%", profile)
    .replaceAll("%VITE_DEN_REQUIRE_SIGNIN%", requireSignin);
  runInNewContext(script, {
    window: { addEventListener: (name: string, callback: (event: object) => void) => { listeners[name] = callback; } },
    location: { origin: "https://zeno.example.test", pathname: "/session" },
    localStorage: { getItem: () => null },
    crypto: { randomUUID: () => "test-id" },
    fetch: (url: string) => { requests.push(url); return Promise.resolve(); },
  });
  listeners.error?.({ message: "Bundle unavailable" });
  listeners.unhandledrejection?.({ reason: new Error("Startup failed") });
  return { requests, listeners };
}

test("a default self-deployed Web build never installs or sends the pre-boot official error beacon", () => {
  const { requests, listeners } = boot("");
  expect(requests).toEqual([]);
  expect(Object.keys(listeners)).toEqual([]);
});

test("the explicit local profile also ignores an inherited monitoring DSN", () => {
  expect(boot("local-gateway").requests).toEqual([]);
});

test("explicit managed builds retain their operator-configured monitoring", () => {
  expect(boot("connected").requests).toHaveLength(2);
  expect(boot("", "1").requests).toHaveLength(2);
});
