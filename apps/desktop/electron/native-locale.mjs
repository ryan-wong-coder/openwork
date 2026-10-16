// Native menus cannot import the renderer's TypeScript translation bundle.
// The preload mirrors the renderer's document language into this small catalog.
let language = "zh";

const chinese = {
  "Close": "关闭",
  "Check for Updates...": "检查更新…",
  "Settings...": "设置…",
  "Settings": "设置",
  "File": "文件",
  "Edit": "编辑",
  "Speech": "语音",
  "View": "视图",
  "Toggle Sidebar": "切换侧栏",
  "Actual Size": "实际大小",
  "Zoom In": "放大",
  "Zoom Out": "缩小",
  "Window": "窗口",
  "Help": "帮助",
  "Docs": "使用文档",
  "About": "关于",
  "Services": "服务",
  "Hide": "隐藏",
  "Hide Others": "隐藏其他应用",
  "Show All": "全部显示",
  "Quit": "退出",
  "Undo": "撤销",
  "Redo": "重做",
  "Cut": "剪切",
  "Copy": "复制",
  "Paste": "粘贴",
  "Paste and Match Style": "粘贴并匹配样式",
  "Delete": "删除",
  "Select All": "全选",
  "Start Speaking": "开始朗读",
  "Stop Speaking": "停止朗读",
  "Reload": "重新加载",
  "Force Reload": "强制重新加载",
  "Toggle Developer Tools": "切换开发者工具",
  "Toggle Full Screen": "切换全屏",
  "Minimize": "最小化",
  "Zoom": "缩放",
  "Bring All to Front": "全部置于前台",
  "Add to Dictionary": "添加到词典",
  "Copy Image": "复制图片",
  "Copy Image Address": "复制图片地址",
  "Copy Link Address": "复制链接地址",
  "Copy URL": "复制 URL",
  "Open in Browser": "在浏览器中打开",
  "Close Tab": "关闭标签页",
  "Close All Tabs": "关闭所有标签页",
  "Open Link in New Tab": "在新标签页中打开链接",
  "Back": "后退",
  "Forward": "前进",
  "Open in OpenWork": "在 OpenWork 中打开",
  "Open in external browser": "在外部浏览器中打开",
  "Open": "打开",
  "Cancel": "取消",
  "New tab": "新标签页",
  "Allow once": "允许一次",
  "Allow website action?": "允许网站操作？",
  "Share website result?": "共享网站结果？",
  "Share result": "共享结果",
  "Suspend browser tab?": "休眠浏览器标签页？",
  "Suspend": "休眠",
  "Your organization's agent permissions are still loading. This page opens once they have.": "正在加载组织的智能体权限。加载完成后会打开此页面。",
  "Your organization doesn't allow you to view this site.": "你的组织不允许你访问此网站。",
  "This page may be incomplete. Your organization's policy blocked a browser request.": "此页面可能不完整。组织策略阻止了一项浏览器请求。",
  "This page may be incomplete. Your organization's policy could not be verified.": "此页面可能不完整。无法验证组织策略。",
  "The browser tab closed or changed owner before navigation.": "导航前，浏览器标签页已关闭或所属会话已更改。",
  "Browser tab is suspending.": "浏览器标签页正在休眠。",
  "Could not open this link": "无法打开此链接",
  "Your browser may be unavailable, or your organization may restrict this destination. You can copy the link address instead.": "浏览器可能不可用，或你的组织限制了此目标地址。你可以复制链接地址。",
  "Proxy must include host and port, e.g. http://user:pass@host:8080 or socks5://host:1080.": "代理地址必须包含主机和端口，例如 http://user:pass@host:8080 或 socks5://host:1080。",
  "OpenWork has 100 saved browser tabs. Close an unused tab, then try again.": "OpenWork 已保存 100 个浏览器标签页。请关闭不再使用的标签页后重试。",
  "The page prevented suspension.": "此页面阻止了休眠。",
  "This site refused the connection. Check that it is running, then reload.": "此网站拒绝了连接。请确认网站正在运行，然后重新加载。",
  "You are offline. Check your connection, then reload.": "你已离线。请检查网络连接，然后重新加载。",
  "This page could not be loaded. Check the address and your connection, then reload.": "无法加载此页面。请检查地址和网络连接，然后重新加载。",
  "Browser tab was closed.": "浏览器标签页已关闭。",
  "Could not reopen browser tab": "无法重新打开浏览器标签页",
  "Try again after checking browser availability and your organization's policy.": "请检查浏览器是否可用及组织策略，然后重试。",
  "Browser tab owner mismatch or unknown tab.": "浏览器标签页所属会话不匹配，或标签页不存在。",
  "Unknown browser tab.": "找不到浏览器标签页。",
  "Browser tab is protected or busy. Release task protection before suspending.": "浏览器标签页受任务保护或正在使用。请解除任务保护后再休眠。",
  "Browser tab is loading, downloading, or playing media.": "浏览器标签页正在加载、下载或播放媒体。",
  "Browser window is unavailable.": "浏览器窗口不可用。",
  "Form input, scroll position, and page history will be lost. Reload opens the saved URL, not the current document. Only suspend if you are willing to lose this page state.": "表单输入、滚动位置和页面历史记录都将丢失。重新加载时会打开保存的 URL，而不会恢复当前文档。仅在你愿意丢失这些页面状态时选择休眠。",
  "Browser tab is still waiting to close.": "浏览器标签页仍在等待关闭。",
  "Browser tab is busy.": "浏览器标签页正在使用。",
  "Browser tab did not become ready.": "浏览器标签页未能就绪。",
  "Could not resolve built-in browser CDP target.": "无法解析内置浏览器的 CDP 目标。",
  "Use the browser toolbar to navigate.": "请使用浏览器工具栏导航。",
  "Select this conversation first.": "请先选择此会话。",
  "Unsupported browser control.": "不支持此浏览器操作。",
  "Browser control disabled": "浏览器控制已禁用",
  "Paused by you": "你已暂停浏览器控制",
  "Open {host}?": "打开 {host}？",
  "Your organization's agent permissions ask before this site opens (set for {source}).": "组织的智能体权限要求打开此网站前先征得同意（针对 {source} 设置）。",
  "No proxy configured: set the {variable} environment variable to a proxy URL.": "未配置代理：请将环境变量 {variable} 设为代理 URL。",
  "Invalid proxy URL: {url}": "无效的代理 URL：{url}",
  "Allow {origin} to run “{tool}”?": "允许 {origin} 运行“{tool}”？",
  "This website tool may change data. Arguments: {arguments}": "此网站工具可能会更改数据。参数：{arguments}",
  "Share the result from {origin} with this conversation and its model provider?": "将来自 {origin} 的结果共享给此会话及其模型提供商？",
  "The website action has already run. Review this complete result for passwords, session cookies, tokens or other private data before sharing. Denying keeps the result out of the conversation and does not undo the action.\n\n{result}": "网站操作已经执行。共享前，请检查这份完整结果是否包含密码、会话 Cookie、令牌或其他隐私数据。拒绝共享会阻止结果进入会话，但不会撤销已执行的操作。\n\n{result}",
  "OpenWork has {count} browser tabs open. Close an unused browser tab in any conversation, then try again.": "OpenWork 已打开 {count} 个浏览器标签页。请在任意会话中关闭不再使用的浏览器标签页，然后重试。",
  "Unknown browser tab: {tabId}": "找不到浏览器标签页：{tabId}",
  "opening websites": "打开网站",
  "opening {resource}": "打开 {resource}",
  "set for {source}": "针对 {source} 设置",
  "\"{resource}\" is blocked for {source}": "已针对 {source} 阻止“{resource}”",
  "Your organization's agent permissions block {subject} ({rule}).": "组织的智能体权限已阻止{subject}（{rule}）。",
  "Allow browser control for this thread?": "允许控制此会话的浏览器？",
  "Allow browser control across this thread's tabs?": "允许控制此会话中的所有浏览器标签页？",
  "Allow for this thread": "允许此会话使用",
  "Allows navigating allowed websites, reading and scrolling using the signed-in browser. Clicking, typing, key input and website tools require separate confirmations. Applies only to this thread until Take over, cancellation of a browser operation, its last tab closes or desktop restart. Organization restrictions still apply.": "允许使用已登录的浏览器访问获准的网站、读取页面和滚动。点击、输入文字、按键和使用网站工具仍需分别确认。授权仅适用于此会话，并在你接管浏览器、取消浏览器操作、关闭此会话的最后一个标签页或重启桌面应用时失效。组织限制仍然适用。",
  "Allow browser action?": "允许浏览器操作？",
  "Allow {action} on {origin}?": "允许在 {origin} 上执行{action}操作？",
  "Target: {target}.{reference}{key}{text} This may submit information or change website data.": "目标：{target}。{reference}{key}{text} 此操作可能会提交信息或更改网站数据。",
  " Reference: {reference}.": " 引用：{reference}。",
  " Key: {key}.": " 按键：{key}。",
  " Text to enter: {text}": " 要输入的文字：{text}",
  "click": "点击",
  "fill": "填入文字",
  "key": "按键",
  "OpenWork could not prepare its default folder": "OpenWork 无法准备默认文件夹",
  "OpenWork is open without a workspace. Use Add workspace in the sidebar to choose another folder.\n\n{error}": "OpenWork 已打开，但尚未连接工作区。请使用侧栏的“添加工作区”选择其他文件夹。\n\n{error}",
};

const roleLabels = {
  about: "About", services: "Services", hide: "Hide", hideOthers: "Hide Others",
  unhide: "Show All", quit: "Quit", undo: "Undo", redo: "Redo", cut: "Cut",
  copy: "Copy", paste: "Paste", pasteAndMatchStyle: "Paste and Match Style",
  delete: "Delete", selectAll: "Select All", startSpeaking: "Start Speaking",
  stopSpeaking: "Stop Speaking", reload: "Reload", forceReload: "Force Reload",
  toggleDevTools: "Toggle Developer Tools", togglefullscreen: "Toggle Full Screen",
  minimize: "Minimize", zoom: "Zoom", front: "Bring All to Front", window: "Window", help: "Help",
};

export function setNativeLanguage(value) {
  // Other supported languages retain Electron's existing OS-localized roles.
  const next = typeof value === "string" && /^zh(?:-|$)/i.test(value) ? "zh" : "en";
  const changed = language !== next;
  language = next;
  return changed;
}

export function nativeText(text) {
  return language === "zh" ? chinese[text] ?? text : text;
}

export function nativeTemplate(text, params = {}) {
  return nativeText(text).replace(/\{([A-Za-z_][\w]*)\}/g, (placeholder, key) =>
    Object.hasOwn(params, key) ? String(params[key]) : placeholder);
}

export function nativeRoleLabel(role) {
  return language === "zh" && roleLabels[role] ? { label: nativeText(roleLabels[role]) } : {};
}

export function localizeMenuTemplate(template) {
  return template.map((item) => ({
    ...item,
    ...(item.label ? { label: nativeText(item.label) } : nativeRoleLabel(item.role)),
    ...(Array.isArray(item.submenu) ? { submenu: localizeMenuTemplate(item.submenu) } : {}),
  }));
}
