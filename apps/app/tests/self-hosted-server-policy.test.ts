import { describe, expect, test } from "bun:test";
import { selfHostedServerAllowed } from "../src/app/lib/self-hosted-server-policy";

describe("self-hosted server endpoint ownership", () => {
  test("keeps desktop loopback and same-origin self-deployments usable", () => {
    expect(selfHostedServerAllowed("http://127.0.0.1:8778/opencode")).toBe(true);
    expect(selfHostedServerAllowed("http://[::1]:8778")).toBe(true);
    expect(selfHostedServerAllowed("https://workspace.example/api/openwork", { appOrigin: "https://workspace.example" })).toBe(true);
    expect(selfHostedServerAllowed("https://workspace.example.evil.test", { appOrigin: "https://workspace.example" })).toBe(false);
  });

  test("honors only the explicitly configured backend path outside the app origin", () => {
    const configuredUrls = ["https://agent.example/service"];
    expect(selfHostedServerAllowed("https://agent.example/service/opencode", { configuredUrls })).toBe(true);
    expect(selfHostedServerAllowed("https://agent.example/service-other", { configuredUrls })).toBe(false);
    expect(selfHostedServerAllowed("https://other.example/service", { configuredUrls })).toBe(false);
    expect(selfHostedServerAllowed("https://old-server.example/opencode")).toBe(false);
  });

  test("does not resurrect official or credential-bearing targets", () => {
    for (const url of ["https://api.openworklabs.com", "https://app.openworklabs.com.", "https://app.openwork.software"]) {
      expect(selfHostedServerAllowed(url, { appOrigin: url, configuredUrls: [url] })).toBe(false);
    }
    expect(selfHostedServerAllowed("https://user:secret@agent.example", { appOrigin: "https://agent.example" })).toBe(false);
    expect(selfHostedServerAllowed("https://agent.example?token=secret", { appOrigin: "https://agent.example" })).toBe(false);
    expect(selfHostedServerAllowed("file:///tmp/agent")).toBe(false);
  });
});
