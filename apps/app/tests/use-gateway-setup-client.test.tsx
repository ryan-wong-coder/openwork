import { afterAll, afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createOpenworkServerClient, type OpenworkServerClient } from "../src/app/lib/openwork-server";
import { useGatewaySetupClient } from "../src/react-app/domains/settings/pages/use-gateway-setup-client";

GlobalRegistrator.register({ url: "http://localhost/" });
const previousAct = Reflect.get(globalThis, "IS_REACT_ACT_ENVIRONMENT");
Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
let host: HTMLDivElement;
let root: Root;
let current: OpenworkServerClient | null;
const connection = { baseUrl: "https://agent.example.test/service", token: "fixture-client", hostToken: "fixture-host", generation: 1 };
type Input = Parameters<typeof useGatewaySetupClient>[0];
function Observe({ input }: { input: Input }) {
  current = useGatewaySetupClient(input);
  return null;
}
async function render(input: Input) {
  await act(async () => root.render(<Observe input={input} />));
  return current;
}
beforeEach(() => {
  host = document.createElement("div"); document.body.append(host); root = createRoot(host); current = null;
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
afterAll(async () => { Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", previousAct); await GlobalRegistrator.unregister(); });

test("route refreshes preserve the client for an unchanged stable connection without sending requests", async () => {
  const fetched = spyOn(globalThis, "fetch").mockRejectedValue(new Error("Unexpected request"));
  try {
    const first = createOpenworkServerClient(connection);
    const recreated = createOpenworkServerClient(connection);
    expect(recreated).not.toBe(first);
    expect(await render({ ...connection, client: first })).toBe(first);
    expect(await render({ ...connection, client: recreated })).toBe(first);
    expect(fetched).not.toHaveBeenCalled();
  } finally { fetched.mockRestore(); }
});

for (const change of [
  { baseUrl: "https://other.example.test/service" },
  { token: "fixture-client-next" },
  { hostToken: "fixture-host-next" },
  { generation: 2 },
]) {
  test(`a change in ${Object.keys(change)[0]} replaces the retained client`, async () => {
    const first = createOpenworkServerClient(connection);
    expect(await render({ ...connection, client: first })).toBe(first);
    const nextConnection = { ...connection, ...change };
    const replacement = createOpenworkServerClient(nextConnection);
    expect(await render({ ...nextConnection, client: replacement })).toBe(replacement);
    expect(await render({ ...nextConnection, client: createOpenworkServerClient(nextConnection) })).toBe(replacement);
  });
}

test("a disconnect returns null and reconnecting cannot reuse the old client", async () => {
  const first = createOpenworkServerClient(connection);
  expect(await render({ ...connection, client: first })).toBe(first);
  expect(await render({ ...connection, client: null })).toBeNull();
  const reconnected = createOpenworkServerClient(connection);
  expect(await render({ ...connection, client: reconnected })).toBe(reconnected);
  expect(reconnected).not.toBe(first);
});

test("missing optional connection fields are equivalent, but arriving host or generation data replaces the client", async () => {
  const minimal = { baseUrl: connection.baseUrl, token: connection.token };
  const first = createOpenworkServerClient(minimal);
  expect(await render({ ...minimal, client: first })).toBe(first);
  expect(await render({ ...minimal, client: createOpenworkServerClient(minimal), hostToken: null, generation: null })).toBe(first);
  const identified = createOpenworkServerClient(connection);
  expect(await render({ ...connection, client: identified })).toBe(identified);
});
