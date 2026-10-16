import {
  MICROSOFT_365_DEFAULT_FEATURES,
  type Microsoft365Feature,
} from "@openwork/types/den/microsoft-365";

export { MICROSOFT_365_DEFAULT_FEATURES };

export type Microsoft365Permission = {
  key: Microsoft365Feature;
  label: string;
  scope: string;
  detail?: string;
};

export type Microsoft365PermissionGroup = {
  name: string;
  permissions: readonly Microsoft365Permission[];
};

export const MICROSOFT_365_PERMISSION_GROUPS: readonly Microsoft365PermissionGroup[] = [
  {
    name: "日历",
    permissions: [
      { key: "calendarRead", label: "读取 Outlook 日历", scope: "Calendars.Read" },
      {
        key: "calendarWrite",
        label: "创建与管理日历事件",
        scope: "Calendars.ReadWrite",
        detail: "Microsoft 将授予成员日历的完整访问权限。",
      },
    ],
  },
  {
    name: "Outlook",
    permissions: [
      {
        key: "mailDraft",
        label: "创建与管理邮件草稿",
        scope: "Mail.ReadWrite",
        detail: "Microsoft 将授予邮箱读写权限，此选项不会发送邮件。",
      },
      { key: "mailRead", label: "读取 Outlook 邮件", scope: "Mail.Read" },
      { key: "mailSend", label: "发送 Outlook 邮件", scope: "Mail.Send", detail: "发送邮件需要明确请求与确认，已保存草稿不会自动发送。" },
      { key: "mailManage", label: "管理已读状态、分类与邮箱文件夹", scope: "Mail.ReadWrite" },
    ],
  },
  {
    name: "OneDrive",
    permissions: [
      { key: "filesRead", label: "读取 OneDrive 文件", scope: "Files.Read" },
      { key: "filesWrite", label: "创建与更新 OneDrive 文件", scope: "Files.ReadWrite" },
      { key: "filesReadAll", label: "读取成员可访问的所有文件", scope: "Files.Read.All" },
      { key: "filesFull", label: "完整访问成员可访问的文件", scope: "Files.ReadWrite.All" },
    ],
  },
  {
    name: "团队",
    permissions: [
      { key: "teamsChatRead", label: "读取 Teams 对话", scope: "Chat.Read" },
      {
        key: "teamsChatSend",
        label: "发送 Teams 对话消息",
        scope: "Chat.Read + ChatMessage.Send",
        detail: "包含对话读取权限，以便 OpenWork 查找已有对话；无法创建新对话。",
      },
    ],
  },
];

export const MICROSOFT_365_DISPLAY_SCOPES = new Set(
  MICROSOFT_365_PERMISSION_GROUPS.flatMap((group) =>
    group.permissions.flatMap((permission) => permission.scope.split(" + ")),
  ),
);
