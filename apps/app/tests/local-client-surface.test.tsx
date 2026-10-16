import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { setClientProfileBootstrap } from "../src/app/lib/client-profile";
import { AccountStatusMenu } from "../src/react-app/domains/session/sidebar/account-status-menu";
import { ShellConfigProvider, useShellConfig } from "../src/react-app/shell/shell-config";

let ownedDom = false;
beforeEach(() => {
  ownedDom = typeof window === "undefined";
  if (ownedDom) GlobalRegistrator.register();
});
afterEach(async () => {
  localStorage.removeItem("openwork.shell-config");
  if (ownedDom) await GlobalRegistrator.unregister();
});

function ShellServiceProbe() {
  const { config } = useShellConfig();
  return <span data-cloud-signin={config.cloudSignin} data-docs={config.docsButton} data-feedback={config.feedbackButton} />;
}

test("saved shell settings cannot restore OpenWork account services in the local client", () => {
  setClientProfileBootstrap({ requireSignin: false, requireActivation: false });
  localStorage.setItem("openwork.shell-config", JSON.stringify({ cloudSignin: true, docsButton: true, feedbackButton: true }));
  const html = renderToStaticMarkup(<ShellConfigProvider><ShellServiceProbe /></ShellConfigProvider>);
  expect(html).toContain('data-cloud-signin="false"');
  expect(html).toContain('data-docs="false"');
  expect(html).toContain('data-feedback="false"');
});

test("local footer renders runtime status and settings without mounting account providers", () => {
  setClientProfileBootstrap({ requireSignin: false, requireActivation: false });
  const html = renderToStaticMarkup(
    <ShellConfigProvider>
      <AccountStatusMenu
        clientConnected
        openworkServerStatus="connected"
        developerMode={false}
        showConnectionStatus
        providerConnectedIds={["modelhelm"]}
        mcpConnectedCount={0}
        onOpenAccountSettings={() => {}}
      />
    </ShellConfigProvider>,
  );
  expect(html).toContain('data-testid="local-client-status"');
  expect(html).toContain('data-runtime-state="connected"');
  expect(html).not.toContain("account-cloud-signin-button");
  expect(html).not.toContain("OpenWork Cloud");
  expect(html).not.toContain("account-status-menu");
});
