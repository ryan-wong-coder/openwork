function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "")
  if (normalized === "localhost" || normalized.endsWith(".localhost") || normalized === "::1") return true
  const octets = normalized.split(".")
  return octets.length === 4
    && octets.every((octet) => /^\d{1,3}$/.test(octet) && Number(octet) <= 255)
    && Number(octets[0]) === 127
}

export function safeMcpAuthorizationUrl(rawUrl: string): string {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new Error("MCP 提供商返回的授权地址无效。")
  }
  const allowedProtocol = url.protocol === "https:"
    || (url.protocol === "http:" && isLoopbackHostname(url.hostname))
  if (!allowedProtocol || url.username || url.password) {
    throw new Error("MCP 提供商返回的授权地址不安全。")
  }
  return url.toString()
}

export type McpAuthorizationDebugDetails = {
  /** "unavailable" when the browser never let the page read a response (network failure or CORS-blocked answer). */
  httpStatus: number | "unavailable"
  errorCode?: string
  diagnosticCode?: string
  redirectUri?: string
  clientMetadataUrl?: string
  diagnosticReference?: string
  phase?: string
  category?: string
  highestPassed?: string
  retryable?: boolean
  actionOwner?: string
  operatorAction?: string
  providerStatus?: number
  providerRequestId?: string
  providerCode?: string
  responseJson: string
}

export type McpAuthorizationFailure = {
  message: string
  details?: McpAuthorizationDebugDetails
}

export type McpAuthorizationTabState = {
  connectionId: string
  connectionName: string
  outcome: "pending" | "failed"
  failure?: McpAuthorizationFailure
}

export type McpAuthorizationFailureDescription = {
  title: string
  description: string
  advice: string[]
  retryable: boolean
  copyable: { label: string; value: string }[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function parseFailurePayload(value: string | null): McpAuthorizationFailure | undefined {
  if (!value) return undefined
  try {
    const parsed: unknown = JSON.parse(value)
    if (!isRecord(parsed) || typeof parsed.message !== "string") return undefined
    const details = isRecord(parsed.details) ? parsed.details : undefined
    const httpStatus = details?.httpStatus
    const responseJson = details?.responseJson
    if (details) {
      if ((typeof httpStatus === "number" || httpStatus === "unavailable") && typeof responseJson === "string") {
        return { message: parsed.message, details: parseDebugDetails(details, httpStatus, responseJson) }
      }
      return { message: parsed.message }
    }
    return { message: parsed.message }
  } catch {
    return undefined
  }
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function parseDebugDetails(
  value: Record<string, unknown>,
  httpStatus: number | "unavailable",
  responseJson: string,
): McpAuthorizationDebugDetails {
  const retryable = typeof value.retryable === "boolean" ? value.retryable : undefined
  return {
    httpStatus,
    ...(optionalString(value.errorCode) ? { errorCode: optionalString(value.errorCode) } : {}),
    ...(optionalString(value.diagnosticCode) ? { diagnosticCode: optionalString(value.diagnosticCode) } : {}),
    ...(optionalString(value.redirectUri) ? { redirectUri: optionalString(value.redirectUri) } : {}),
    ...(optionalString(value.clientMetadataUrl) ? { clientMetadataUrl: optionalString(value.clientMetadataUrl) } : {}),
    ...(optionalString(value.diagnosticReference) ? { diagnosticReference: optionalString(value.diagnosticReference) } : {}),
    ...(optionalString(value.phase) ? { phase: optionalString(value.phase) } : {}),
    ...(optionalString(value.category) ? { category: optionalString(value.category) } : {}),
    ...(optionalString(value.highestPassed) ? { highestPassed: optionalString(value.highestPassed) } : {}),
    ...(retryable !== undefined ? { retryable } : {}),
    ...(optionalString(value.actionOwner) ? { actionOwner: optionalString(value.actionOwner) } : {}),
    ...(optionalString(value.operatorAction) ? { operatorAction: optionalString(value.operatorAction) } : {}),
    ...(optionalNumber(value.providerStatus) !== undefined ? { providerStatus: optionalNumber(value.providerStatus) } : {}),
    ...(optionalString(value.providerRequestId) ? { providerRequestId: optionalString(value.providerRequestId) } : {}),
    ...(optionalString(value.providerCode) ? { providerCode: optionalString(value.providerCode) } : {}),
    responseJson,
  }
}

export function mcpAuthorizationTabUrl(state: {
  connectionId: string
  connectionName: string
  failure?: McpAuthorizationFailure
}): string {
  const searchParams = new URLSearchParams({
    connection: state.connectionId,
    name: state.connectionName,
  })
  if (state.failure) {
    searchParams.set("outcome", "failed")
    searchParams.set("failure", JSON.stringify(state.failure))
  }
  return `/connect/oauth?${searchParams.toString()}`
}

export function parseMcpAuthorizationTabState(searchParams: URLSearchParams): McpAuthorizationTabState {
  const connectionId = searchParams.get("connection")?.trim() ?? ""
  const connectionName = searchParams.get("name")?.trim() || "此提供商"
  const failure = searchParams.get("outcome") === "failed"
    ? parseFailurePayload(searchParams.get("failure"))
    : undefined
  return {
    connectionId,
    connectionName,
    outcome: failure ? "failed" : "pending",
    ...(failure ? { failure } : {}),
  }
}

export function describeMcpAuthorizationFailure(input: {
  connectionName: string
  message: string
  details?: McpAuthorizationDebugDetails
}): McpAuthorizationFailureDescription {
  const { connectionName, message, details } = input
  if (details?.diagnosticCode === "MCP_OAUTH_REDIRECT_URI_NOT_ALLOWED") {
    return {
      title: `${connectionName} 尚未批准 OpenWork`,
      description: `${connectionName} 的登录服务器仅接受预先批准的应用，OpenWork 的登录地址尚未加入允许列表。请联系 ${connectionName} 添加 OpenWork，重新尝试无法解决此问题。`,
      advice: [
        details.redirectUri
          ? `请联系 ${connectionName} 将此跳转 URI 加入允许列表：${details.redirectUri}`
          : `请联系 ${connectionName} 将 OpenWork 的跳转 URI 加入允许列表。`,
        "请将诊断引用提供给他们。",
        "请联系工作区管理员，确认能否改用提供商预先注册的 OAuth 应用。",
      ],
      retryable: false,
      copyable: [
        ...(details.redirectUri ? [{ label: "重定向 URI", value: details.redirectUri }] : []),
        ...(details.diagnosticReference ? [{ label: "引用", value: details.diagnosticReference }] : []),
      ],
    }
  }

  if (details?.errorCode === "response_unreadable") {
    return {
      title: "OpenWork 无法读取自身 API 的响应",
      description: message,
      advice: [
        "请重试。",
        "若问题持续，请将此次尝试的时间告知工作区管理员。",
      ],
      retryable: true,
      copyable: [],
    }
  }

  const retryable = details?.retryable !== false
  const ownerAdvice = details?.actionOwner === "provider_admin"
    ? `需要由 ${connectionName} 修复此问题，请将下方参考信息提供给他们。`
    : details?.actionOwner === "organization_admin"
      ? "请联系工作区管理员检查此连接的配置。"
      : details?.actionOwner === "member"
        ? retryable ? "请重新连接。" : undefined
        : details?.actionOwner === "openwork"
          ? "请携带下方引用联系 OpenWork 支持。"
          : undefined
  return {
    title: `无法启动 ${connectionName} 登录`,
    description: message,
    advice: ownerAdvice ? [ownerAdvice] : retryable ? ["请重试。"] : [],
    retryable,
    copyable: details?.diagnosticReference
      ? [{ label: "引用", value: details.diagnosticReference }]
      : [],
  }
}

export function showMcpAuthorizationFailure(
  tab: Window | null,
  input: {
    connectionId: string
    connectionName: string
    message: string
    details?: McpAuthorizationDebugDetails
  },
): void {
  if (!tab || tab.closed) return
  try {
    const failureUrl = new URL(mcpAuthorizationTabUrl({
      connectionId: input.connectionId,
      connectionName: input.connectionName,
      failure: {
        message: input.message,
        ...(input.details ? { details: input.details } : {}),
      },
    }), window.location.origin)
    tab.location.replace(failureUrl.toString())
  } catch {
    // Leave an isolated provider tab open so its own error remains available.
  }
}

export function openMcpAuthorizationTab(input: {
  connectionId: string
  connectionName: string
}): Window {
  const tabName = `openwork-mcp-authorization-${crypto.randomUUID()}`
  const tab = window.open(mcpAuthorizationTabUrl(input), tabName)
  if (!tab) {
    throw new Error("OpenWork 无法打开登录标签页，请允许弹出窗口后重试。")
  }
  tab.opener = null
  return tab
}
