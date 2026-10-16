import { shouldShowTemporaryAuthNotice } from "../_lib/temporary-auth-notice";
import { DenNotice } from "./ui/notice";

export function TemporaryAuthNotice() {
  if (!shouldShowTemporaryAuthNotice()) return null;

  return (
    <DenNotice
      tone="warning"
      className="leading-5"
      message={(
        <span className="grid gap-2">
          <span>
            <strong className="font-semibold">登录遇到问题？</strong> 身份验证系统近期已更新。若登录或注册无法完成，请清除此网站保存的数据： <strong className="font-semibold">openworklabs.com</strong>，然后强制刷新。清除网站数据会退出登录。
          </span>
          <span className="grid gap-1 text-[13px]">
            <span><strong className="font-semibold">Chrome 或 Edge：</strong> 打开地址栏旁的网站控制项，清除 Cookie 与网站数据，然后按 Cmd/Ctrl+Shift+R。</span>
            <span><strong className="font-semibold">Safari：</strong> 前往 Safari 的“设置 → 隐私 → 管理网站数据”，移除 openworklabs.com 后重新加载。</span>
            <span><strong className="font-semibold">Firefox 或其他浏览器：</strong> 在网站设置中清除 openworklabs.com 的 Cookie 与网站数据，然后按 Cmd/Ctrl+Shift+R。</span>
          </span>
        </span>
      )}
    />
  );
}
