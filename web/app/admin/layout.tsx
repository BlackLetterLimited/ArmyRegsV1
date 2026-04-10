import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import AdminShell from "../../components/admin/admin-shell";
import { getServerSessionUser } from "../../lib/server-auth";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const user = await getServerSessionUser();
  if (!user) {
    redirect("/");
  }
  if (user.admin !== true) {
    redirect("/chat");
  }

  return <AdminShell userEmail={user.email ?? null}>{children}</AdminShell>;
}
