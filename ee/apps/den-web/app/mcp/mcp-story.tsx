"use client";

import {
  SetupAppMark,
  SetupLetterTile,
  SetupNewWorkspaceTile,
  SetupStoryTile,
  SetupStoryTiles,
} from "../(den)/_components/setup-frame-parts";
import type { McpClient } from "./use-mcp-client";

/** Story-column copy for an agent's sign-in, named after the app when it shared a name. */
export function mcpStoryCopy(client: Pick<McpClient, "name">) {
  return client.name
    ? { title: `连接 ${client.name}。`, description: `${client.name} 请求以你的身份使用 OpenWork。` }
    : { title: "连接应用", description: "有应用请求以你的身份使用 OpenWork。" };
}

/** The app that asked, joined to the workspace it will use (or a new one). */
export function McpStoryTiles({ client, workspaceName, appHost = null }: { client: McpClient; workspaceName: string | null; appHost?: string | null }) {
  const appLabel = client.name ?? appHost ?? "一个应用";
  return (
    <SetupStoryTiles
      from={{
        label: appLabel,
        mark: (
          <SetupStoryTile>
            <SetupAppMark name={client.name} logoUri={client.logoUri} size={26} />
          </SetupStoryTile>
        ),
      }}
      to={
        workspaceName
          ? { label: workspaceName, mark: <SetupLetterTile name={workspaceName} size="lg" /> }
          : { label: "新建工作区", mark: <SetupNewWorkspaceTile />, pending: true }
      }
    />
  );
}

/** "Claude Code" with its mark, for the App / Signing in for fact rows. */
export function McpAppFact({ client }: { client: McpClient }) {
  return (
    <>
      <SetupAppMark name={client.name} logoUri={client.logoUri} />
      <span className="truncate" data-testid="mcp-client-name">{client.loaded ? client.name ?? "未命名应用" : "…"}</span>
    </>
  );
}
