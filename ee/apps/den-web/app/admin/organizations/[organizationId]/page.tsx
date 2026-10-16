import { AdminOrganizationPage } from "../../../../components/admin/admin-organization-page";

export const metadata = { title: "组织成员 | OpenWork 管理后台" };

export default async function OrganizationPage({ params }: { params: Promise<{ organizationId: string }> }) {
  const { organizationId } = await params;
  return <AdminOrganizationPage key={organizationId} organizationId={organizationId} section="members" />;
}
