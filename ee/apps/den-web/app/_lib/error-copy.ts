/** Translate known service errors without changing identifiers or user content. */
const ERROR_COPY: Record<string, string> = {
  "The upstream service could not be reached.": "无法连接上游服务，请检查网络后重试。",
  "The upstream service did not respond before the deadline.": "上游服务响应超时，请稍后重试。",
  "DEN_API_BASE must be configured.": "尚未配置服务地址，请联系部署管理员。",
  "Could not resolve Den API origin.": "无法确定服务地址，请联系部署管理员。",
  "request_too_large": "请求内容过大，请减少内容后重试。",
  "forbidden_origin": "此来源不允许发起请求，请从当前部署的页面重试。",
  "invalid_api_path": "请求路径无效，请刷新页面后重试。",
  "upstream_timeout": "上游服务响应超时，请稍后重试。",
  "upstream_unreachable": "无法连接上游服务，请检查网络后重试。",
  "The upstream service timed out.": "上游服务响应超时，请稍后重试。",
  "The request failed.": "请求失败，请重试。",
  "Failed to fetch": "网络连接失败，请检查连接后重试。",
  "NetworkError when attempting to fetch resource.": "网络连接失败，请检查连接后重试。",
  "Unauthorized": "登录已失效，请重新登录。",
  "Forbidden": "你没有执行此操作的权限，请联系管理员。",
  "Not found": "未找到此内容，请刷新后重试。",
  "Internal server error": "服务暂时不可用，请稍后重试。",
  "Too many requests": "请求过于频繁，请稍后重试。",
  "Invalid email or password": "邮箱或密码不正确，请检查后重试。",
  "Invalid email or password.": "邮箱或密码不正确，请检查后重试。",
  "Email not verified": "邮箱尚未验证，请先验证邮箱。",
  "Session expired": "会话已过期，请重新登录。",
  "Organization not found": "未找到组织，请刷新后重试。",
  "Member not found": "未找到成员，请刷新后重试。",
  "Provider not found": "未找到提供商，请刷新后重试。",
  "Connection not found": "未找到连接，请刷新后重试。",
};

export function localizeDenError(message: string): string {
  return ERROR_COPY[message.trim()] ?? message;
}
