import { AdminDataPage } from "../../../components/admin/admin-data-page";

export const metadata = { title: "用户 | OpenWork 管理后台" };

export default function AdminUsersPage() {
  return <AdminDataPage section="users" />;
}
