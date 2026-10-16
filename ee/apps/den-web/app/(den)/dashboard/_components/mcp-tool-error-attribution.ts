export type ExternalMcpDiagnostic = {
  referenceId?: string;
  phase?: string;
  category?: string;
  code?: string;
  retryable?: boolean;
  actionOwner?: "openwork" | "network_admin" | "provider_admin" | "organization_admin" | "member";
  operatorAction?: string;
  message?: string;
  highestPassed?: "configured" | "reachable" | "authorized" | "protocol_ready" | "catalog_ready" | "operation_ready";
  httpStatus?: number;
  operationPhase?: string;
  providerStatus?: number;
  providerRequestId?: string;
  providerCode?: string;
  connectUrl?: string;
};

type InspectionEvidence = {
  request?: unknown;
  response?: {
    status: number;
    headers?: Array<{ name: string; value: string; redacted: boolean }>;
  };
  diagnosis?: {
    layer?: string;
    summary?: string;
  };
};

type BrowserTimeoutEvidence = {
  timeoutMs: number;
  outcome: "unknown";
};

export type ExternalMcpFailureAttribution = {
  summary: string;
  lastConfirmedBoundary: string;
  likelySource: string;
  confidence: "Confirmed" | "Inferred";
  retryGuidance: string;
  outcome: "failed" | "unknown";
  diagnosticReference?: string;
  providerRequestId?: string;
  diagnosticCode?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function optionalActionOwner(value: unknown): ExternalMcpDiagnostic["actionOwner"] {
  if (
    value === "openwork"
    || value === "network_admin"
    || value === "provider_admin"
    || value === "organization_admin"
    || value === "member"
  ) return value;
  return undefined;
}

function optionalHighestPassed(value: unknown): ExternalMcpDiagnostic["highestPassed"] {
  if (
    value === "configured"
    || value === "reachable"
    || value === "authorized"
    || value === "protocol_ready"
    || value === "catalog_ready"
    || value === "operation_ready"
  ) return value;
  return undefined;
}

export function parseExternalMcpDiagnostic(value: unknown): ExternalMcpDiagnostic | null {
  if (!isRecord(value)) return null;

  const referenceId = optionalString(value.referenceId);
  const phase = optionalString(value.phase);
  const category = optionalString(value.category);
  const code = optionalString(value.code);
  const actionOwner = optionalActionOwner(value.actionOwner);
  const operatorAction = optionalString(value.operatorAction);
  const message = optionalString(value.message);
  const highestPassed = optionalHighestPassed(value.highestPassed);
  const httpStatus = optionalNumber(value.httpStatus);
  const operationPhase = optionalString(value.operationPhase);
  const providerStatus = optionalNumber(value.providerStatus);
  const providerRequestId = optionalString(value.providerRequestId);
  const providerCode = optionalString(value.providerCode);
  const connectUrl = optionalString(value.connectUrl);
  const diagnostic: ExternalMcpDiagnostic = {
    ...(referenceId ? { referenceId } : {}),
    // Keep unknown future phases/categories as safe strings so an older
    // dashboard can still show the reference and fall back to wire evidence.
    ...(phase ? { phase } : {}),
    ...(category ? { category } : {}),
    ...(code ? { code } : {}),
    ...(typeof value.retryable === "boolean" ? { retryable: value.retryable } : {}),
    ...(actionOwner ? { actionOwner } : {}),
    ...(operatorAction ? { operatorAction } : {}),
    ...(message ? { message } : {}),
    ...(highestPassed ? { highestPassed } : {}),
    ...(httpStatus !== undefined ? { httpStatus } : {}),
    ...(operationPhase ? { operationPhase } : {}),
    ...(providerStatus !== undefined ? { providerStatus } : {}),
    ...(providerRequestId ? { providerRequestId } : {}),
    ...(providerCode ? { providerCode } : {}),
    ...(connectUrl ? { connectUrl } : {}),
  };

  return Object.keys(diagnostic).length > 0 ? diagnostic : null;
}

function providerRequestIdFromInspection(inspection: InspectionEvidence | null): string | undefined {
  const requestIdHeaders = new Set([
    "x-ms-request-id",
    "x-ms-correlation-request-id",
    "x-servicenow-request-id",
    "x-correlation-id",
    "x-transaction-id",
    "request-id",
    "x-request-id",
  ]);
  return inspection?.response?.headers?.find((header) => (
    !header.redacted
    && requestIdHeaders.has(header.name.toLowerCase())
    && header.value.trim().length > 0
  ))?.value;
}

function unknownOutcomeGuidance(mayHaveSideEffects: boolean): string {
  return mayHaveSideEffects
    ? "请勿立即重试。此工具可能已更改外部数据，请先确认提供商状态。"
    : "首次调用仍可能完成，请先检查提供商近期活动再重试。";
}

function lastBoundaryFromDiagnostic(diagnostic: ExternalMcpDiagnostic | null): string | undefined {
  if (diagnostic?.highestPassed === "operation_ready") return "OpenWork 已开始执行远程工具";
  if (diagnostic?.highestPassed === "catalog_ready") return "OpenWork 已加载远程 MCP 工具目录";
  if (diagnostic?.highestPassed === "protocol_ready") return "OpenWork 已初始化远程 MCP 会话";
  if (diagnostic?.highestPassed === "authorized") return "远程 MCP 已接受连接凭据";
  if (diagnostic?.highestPassed === "reachable") return "OpenWork 已连接远程 MCP 端点";
  if (diagnostic?.highestPassed === "configured") return "OpenWork 已加载 MCP 连接配置";
  return undefined;
}

function diagnosticDetails(diagnostic: ExternalMcpDiagnostic | null, inspection: InspectionEvidence | null) {
  const providerRequestId = diagnostic?.providerRequestId ?? providerRequestIdFromInspection(inspection);
  return {
    ...(diagnostic?.referenceId ? { diagnosticReference: diagnostic.referenceId } : {}),
    ...(providerRequestId ? { providerRequestId } : {}),
    ...(diagnostic?.code || diagnostic?.category
      ? { diagnosticCode: diagnostic.code ?? diagnostic.category }
      : {}),
  };
}

export function attributeExternalMcpToolFailure(input: {
  diagnostic: ExternalMcpDiagnostic | null;
  inspection: InspectionEvidence | null;
  browserTimeout: BrowserTimeoutEvidence | null;
  mayHaveSideEffects: boolean;
}): ExternalMcpFailureAttribution {
  const { browserTimeout, diagnostic, inspection, mayHaveSideEffects } = input;
  const details = diagnosticDetails(diagnostic, inspection);

  if (browserTimeout) {
    const seconds = browserTimeout.timeoutMs / 1000;
    const duration = Number.isInteger(seconds) ? `${seconds}` : seconds.toFixed(1);
    return {
      summary: `等待 ${duration} 秒后 OpenWork 已停止等待，操作结果未知。`,
      lastConfirmedBoundary: "OpenWork 控制台已发送请求",
      likelySource: "OpenWork 超时后无法确定故障来源",
      confidence: "Inferred",
      retryGuidance: unknownOutcomeGuidance(mayHaveSideEffects),
      outcome: "unknown",
      ...details,
    };
  }

  const blockedBeforeSend = diagnostic?.category === "security_blocked"
    || diagnostic?.code === "MCP_URL_BLOCKED"
    || diagnostic?.code === "MCP_FETCH_FORBIDDEN_PORT";
  if (blockedBeforeSend) {
    return {
      summary: "OpenWork 在发送前阻止了此请求。",
      lastConfirmedBoundary: "OpenWork 已检查出站请求",
      likelySource: "OpenWork",
      confidence: "Confirmed",
      retryGuidance: diagnostic?.operatorAction ?? "请先修复 OpenWork 策略或连接配置，再运行工具。",
      outcome: "failed",
      ...details,
    };
  }

  const responseStatus = inspection?.response?.status ?? diagnostic?.httpStatus;
  if (responseStatus !== undefined && (responseStatus < 200 || responseStatus >= 300)) {
    const retryableStatus = responseStatus === 408 || responseStatus === 429 || responseStatus === 502
      || responseStatus === 503 || responseStatus === 504;
    return {
      summary: `远程 MCP 返回 HTTP ${responseStatus}。`,
      lastConfirmedBoundary: `远程 MCP 返回 HTTP ${responseStatus}`,
      likelySource: "远程 MCP",
      confidence: "Confirmed",
      retryGuidance: mayHaveSideEffects && (responseStatus === 408 || responseStatus === 504)
        ? "重试前，请先确认远程 MCP 或提供商中操作是否已完成。"
        : diagnostic?.operatorAction
          ?? (diagnostic?.retryable || retryableStatus
            ? "确认可安全重复操作后，按有限退避间隔重试。"
            : "请检查远程 MCP 响应与配置后再重试。"),
      outcome: "failed",
      ...details,
    };
  }

  const providerFailure = diagnostic?.phase?.startsWith("PROVIDER_")
    || diagnostic?.providerStatus !== undefined
    || diagnostic?.providerCode !== undefined;
  if (diagnostic?.code === "MCP_PROVIDER_AUTH_REQUIRED") {
    return {
      summary: "远程 MCP 已响应，下游提供商需要用户授权。",
      lastConfirmedBoundary: responseStatus !== undefined
        ? `远程 MCP 返回 HTTP ${responseStatus}，并请求授权`
        : "远程 MCP 返回了授权请求",
      likelySource: "下游提供商授权",
      confidence: "Confirmed",
      retryGuidance: diagnostic.operatorAction ?? "请连接提供商账户后重试。",
      outcome: "failed",
      ...details,
    };
  }
  if (providerFailure) {
    return {
      summary: "远程 MCP 已响应，但下游提供商拒绝了操作。",
      lastConfirmedBoundary: responseStatus !== undefined
        ? `远程 MCP 返回 HTTP ${responseStatus}，并报告工具错误`
        : "远程 MCP 返回了工具错误",
      likelySource: "下游提供商",
      confidence: "Confirmed",
      retryGuidance: diagnostic?.operatorAction
        ?? (diagnostic?.retryable
          ? "请检查提供商状态后，按有限退避间隔重试。"
          : "请修复提供商错误后再重试。"),
      outcome: "failed",
      ...details,
    };
  }

  const deadlineAfterSend = Boolean(inspection?.request)
    && !inspection?.response
    && (diagnostic?.code === "MCP_LIFECYCLE_DEADLINE" || diagnostic?.code === "MCP_REQUEST_TIMEOUT");
  if (deadlineAfterSend) {
    return {
      summary: "OpenWork 已发送请求，但远程 MCP 未在时限内响应。",
      lastConfirmedBoundary: "OpenWork 已开始调用外部工具",
      likelySource: "网络或远程 MCP",
      confidence: "Inferred",
      retryGuidance: unknownOutcomeGuidance(mayHaveSideEffects),
      outcome: "unknown",
      ...details,
    };
  }

  if (inspection?.request && !inspection.response) {
    return {
      summary: "OpenWork 已开始出站请求，但未捕获 HTTP 响应，尚不能确定故障由远程 MCP 引起。",
      lastConfirmedBoundary: "OpenWork 已开始调用外部工具",
      likelySource: "发送后无法确定故障来源",
      confidence: "Inferred",
      retryGuidance: unknownOutcomeGuidance(mayHaveSideEffects),
      outcome: "unknown",
      ...details,
    };
  }

  if (inspection?.response) {
    return {
      summary: inspection.diagnosis?.summary ?? "远程 MCP 已响应，但工具执行结果不成功。",
      lastConfirmedBoundary: `远程 MCP 返回 HTTP ${inspection.response.status}`,
      likelySource: "MCP 工具结果",
      confidence: "Inferred",
      retryGuidance: diagnostic?.operatorAction ?? "请检查 MCP 工具结果与诊断引用后再重试。",
      outcome: "failed",
      ...details,
    };
  }

  const networkSetup = diagnostic?.phase?.startsWith("NETWORK_") || inspection?.diagnosis?.layer === "network";
  return {
    summary: inspection?.diagnosis?.summary
      ?? diagnostic?.message
      ?? "OpenWork 收到工具结果前，请求已失败。",
    lastConfirmedBoundary: lastBoundaryFromDiagnostic(diagnostic)
      ?? (diagnostic ? "OpenWork 返回了结构化诊断" : "OpenWork 控制台已发送请求"),
    likelySource: networkSetup ? "连接路径或远程 MCP" : "OpenWork 或 MCP 配置",
    confidence: "Inferred",
    retryGuidance: diagnostic?.operatorAction ?? "请通过诊断引用检查 OpenWork 与 MCP 连接健康状态后再重试。",
    outcome: "failed",
    ...details,
  };
}
