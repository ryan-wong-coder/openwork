/**
 * Copy for the OAuth error page that Better Auth redirects to when an
 * authorization request cannot continue and there is no trusted redirect URI
 * to return the error to (DESIGN.md C6: what happened + the next action).
 */
export type OAuthErrorPageState = {
  code: string;
  title: string;
  description: string;
  detail: string | null;
  advice: string[];
};

const KNOWN: Record<string, { title: string; description: string; advice: string[] }> = {
  invalid_redirect: {
    title: "应用返回地址尚未注册",
    description: "应用请求返回未注册的地址，OpenWork 无法将你送回应用。",
    advice: [
      "请联系应用开发者注册返回地址后重新连接。",
      "如果你是应用开发者，请将地址添加到 OAuth 客户端或元数据文档中。",
    ],
  },
  invalid_client: {
    title: "OpenWork 无法识别此应用",
    description: "应用使用了 OpenWork 无法找到或获取的客户端 ID 发起登录。",
    advice: [
      "请返回应用重新连接。",
      "如果问题持续出现，请将技术详情提供给应用开发者。",
    ],
  },
  client_disabled: {
    title: "此应用已被停用",
    description: "管理员已禁用此应用的登录。",
    advice: ["如需恢复此应用，请联系 OpenWork 管理员。"],
  },
  unauthorized_client: {
    title: "此应用无法使用此登录方式",
    description: "应用已注册，但不支持所请求的登录类型。",
    advice: ["请将技术详情提供给应用开发者。"],
  },
};

const MALFORMED = new Set([
  "invalid_request",
  "unsupported_response_type",
  "request_not_supported",
  "request_uri_not_supported",
  "invalid_request_uri",
  "unsupported_prompt_select_account",
]);

const SAFE_CODE = /^[A-Za-z0-9_-]{1,64}$/;

export function describeOAuthError(params: URLSearchParams): OAuthErrorPageState {
  const raw = params.get("error")?.trim() ?? "";
  const code = SAFE_CODE.test(raw) ? raw : "unknown";
  const rawDetail = params.get("error_description")?.trim() ?? "";
  const detail = rawDetail ? rawDetail.slice(0, 500) : null;
  const known = KNOWN[code];
  if (known) return { code, detail, ...known };
  if (MALFORMED.has(code)) {
    return {
      code,
      detail,
      title: "登录请求格式错误",
      description: "应用发送了 OpenWork 无法处理的登录请求。",
      advice: ["请返回应用重新连接。", "如果问题持续出现，请将技术详情提供给应用开发者。"],
    };
  }
  return {
    code,
    detail,
    title: "无法完成登录",
    description: "OpenWork 已在完成前停止此次登录。",
    advice: ["请返回应用重试。", "如果问题持续出现，请将技术详情提供给应用开发者。"],
  };
}
