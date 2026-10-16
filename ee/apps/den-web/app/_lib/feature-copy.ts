import type { FeatureKey } from "@openwork/features";

type FeatureCopy = { label: string; description: string };

/** Keyed by the stable feature id; backend labels never control translated UI. */
export const DEN_FEATURE_COPY: Record<FeatureKey, FeatureCopy> = {
  gatewayImageGeneration: { label: "网关图像生成", description: "通过配置的推理网关生成和编辑工作区图像，供对话与代码工具继续使用。" },
  visualConfiguration: { label: "可视化配置", description: "使用结构化控件编辑完整的项目和全局代理配置，同时保留自定义字段与文档注释。" },
  secureSecretFields: { label: "对话中的安全密钥输入", description: "代理配置连接、插件或网关时，成员在私密字段中输入密钥，保存后代理继续执行。密钥可临时显示，已保存的密钥可替换。" },
  memberListToolbars: { label: "成员列表工具栏", description: "在添加操作旁筛选成员、团队和角色，使用紧凑的成员行，并在列表菜单中提供次要操作。" },
  appBuildProgress: { label: "应用构建进度", description: "代理创建或修改 MCP 应用时，对话以清单和进度条显示工具检查、编写、构建与验证阶段。" },
  modelsAnalyticsUi: { label: "模型分析", description: "组织管理员可查看模型、用量分析和共享用量限额。此功能已于 2026-10-14 弃用并默认关闭；若无组织依赖，计划在 2026-11-11 前移除。" },
  taskAnalyticsUi: { label: "任务分析", description: "拥有分析权限的成员可查看任务活动与用量，管理员可配置分析集成。此功能已于 2026-10-14 弃用并默认关闭；若无组织依赖，计划在 2026-11-11 前移除。" },
  desktopPolicyScreenRemoval: { label: "在团队中管理桌面建议", description: "在“所有人”和团队的桌面标签中管理提示词建议，需要启用团队页面标签。关闭后恢复桌面策略页面，已存储策略保持不变。" },
  teamMembershipCache: { label: "团队成员缓存", description: "减少重复的团队查询，同时确保访问权限更改立即生效。仅在所有 API 实例均支持版本感知的团队写入后启用。" },
  managedDeploymentsGcp: { label: "GCP 托管部署", description: "组织管理员在自己的 Google Cloud 项目中批准安装 OpenWork，并跟踪健康状态与更新。" },
  managedDeploymentsMcp: { label: "代理中的托管部署", description: "连接 OpenWork 的代理可检查部署就绪状态、创建部署、准备云端批准链接或命令，并跟踪部署进度。" },
  managedDeployments: { label: "托管部署", description: "组织管理员可在自己的云账户中安装 OpenWork（优先支持 AWS），并查看健康状态与更新。" },
  slackAssistant: { label: "Slack 助手", description: "配置 Slack 连接器后，为组织回复 Slack 提及和私信。" },
  slackWorkbotReplies: { label: "Slack 的 Workbot 回复体验", description: "OpenWork 在 Slack 中边工作边回复、回应消息，并将较长任务转入后台，完成后将结果发布到原会话。" },
  workbot: { label: "Workbot", description: "成员可使用 Workbot、侧边对话、自动化日历和重新运行已停止任务。管理员可设置 Workbot、Slack 助手及云端自动化的默认模型。需要部署 Workbot 应用。" },
  automationCalendar: { label: "桌面日历", description: "在桌面日历中同时查看自动化，以及已连接的 Google 或 Outlook 日历会议。" },
  permissions: { label: "权限", description: "组织管理员可设置成员、管理员和各团队的权限，替代固定的成员与管理员默认权限。" },
  teamRoles: { label: "团队角色", description: "在成员的团队列表中查看成员、管理员或自定义角色，通过统一操作更改角色，并在角色标签中查看和创建角色。" },
  sharedRoles: { label: "共享角色", description: "一个自定义角色可分配给多个团队，角色页面显示所属团队，也可提前创建尚未分配的角色。需要团队角色和权限功能。" },
  agentPermissions: { label: "代理权限", description: "组织管理员可按全员或团队设置代理的命令执行、文件编辑、网站访问、本地技能和 MCP 服务器权限。" },
  engineV2Upgrade: { label: "桌面端 OpenCode v2 升级提示", description: "仍使用 OpenCode v1 的桌面成员可选择升级。系统先备份并将对话复制到 v2，再切换引擎。" },
  remoteSessionEvents: { label: "远程会话事件", description: "MCP 客户端可订阅远程会话回执的变更，并在重新连接后读取当前状态。" },
  backgroundShellTasks: { label: "对话中的后台命令", description: "桌面对话显示代理仍在后台运行的命令数量，并在每项命令完成时添加简短记录。" },
  orgDefaultModel: { label: "组织默认模型", description: "管理员可为全员或团队设置新建桌面对话的默认模型。仅适用于 OpenCode v2，成员仍可在每次对话中切换模型。" },
  gatewayProviderUsageLimits: { label: "按 AI 提供商限制网关用量", description: "管理员可为单个 AI 提供商设置消费限额，其费用单独计算，成员可看到哪个提供商已达到限额。" },
  teamAccessRows: { label: "团队访问权限列表", description: "以紧凑列表显示团队插件访问权限及来源，撤销团队授权前要求确认。" },
  teamPageTabs: { label: "团队的浏览器与模型标签", description: "在团队及“所有人”页面管理代理和内置浏览器可访问的网站，以及可用 AI 提供商、消费限额和默认模型。" },
  inviteLinkVerifiesEmail: { label: "邀请链接验证受邀邮箱", description: "通过邮件或管理员共享的邀请链接创建账户即完成受邀邮箱验证，无需额外输入邮件验证码。" },
  remoteSessionSubagents: { label: "将其他计算机上的任务显示为子代理", description: "代理在云端或其他计算机上发起的任务会在对话中显示工作、等待回复或已完成状态，成员可打开、跟进和停止任务。" },
};

export function denFeatureCopy(key: string, fallback: FeatureCopy): FeatureCopy {
  return Object.entries(DEN_FEATURE_COPY).find(([id]) => id === key)?.[1] ?? fallback;
}
