export type NativePermission = { key: string; label: string; scope?: string; detail?: string };
export type NativePermissionGroup = { name: string; permissions: readonly NativePermission[] };

export const GOOGLE_WORKSPACE_DEFAULT_FEATURES: readonly string[] = ["calendarRead", "gmailDraft", "driveFile"];

export const GOOGLE_WORKSPACE_PERMISSION_GROUPS: readonly NativePermissionGroup[] = [
  {
    name: "日历",
    permissions: [
      { key: "calendarRead", label: "读取日历" },
      { key: "calendarWrite", label: "创建、编辑和取消日历事件" },
    ],
  },
  {
    name: "Gmail",
    permissions: [
      { key: "gmailDraft", label: "创建和编辑邮件草稿" },
      { key: "gmailSend", label: "确认后发送邮件草稿" },
      { key: "gmailRead", label: "读取 Gmail" },
      { key: "gmailManage", label: "管理 Gmail：发送、归档、已读状态、标签和回收站" },
      { key: "gmailLabels", label: "创建和管理 Gmail 标签" },
    ],
  },
  {
    name: "Drive",
    permissions: [
      { key: "driveFile", label: "操作所选云端硬盘文件" },
      { key: "driveRead", label: "读取所有云端硬盘文件" },
      { key: "driveFull", label: "完整云端硬盘访问权限" },
    ],
  },
  {
    name: "表格",
    permissions: [
      { key: "sheetsRead", label: "读取电子表格" },
      { key: "sheetsWrite", label: "创建电子表格和编辑单元格" },
    ],
  },
  {
    name: "聊天",
    permissions: [
      { key: "chat", label: "Google Chat" },
    ],
  },
];
