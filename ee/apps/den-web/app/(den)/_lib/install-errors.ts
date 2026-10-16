import { getErrorMessage } from "./den-flow";

const EXPIRED_INSTALL_LINK_MESSAGE = "此安装链接已过期或被替换，请联系工作区管理员从“成员”页面获取新链接。";

export function getInstallConfigErrorMessage(payload: unknown, status: number) {
  if (status === 404) {
    return EXPIRED_INSTALL_LINK_MESSAGE;
  }

  return getErrorMessage(payload, `无法加载此安装链接（${status}）。`);
}
