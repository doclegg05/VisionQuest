import { redirect } from "next/navigation";

import NavBar from "@/components/ui/NavBar";
import NotificationProvider from "@/components/ui/NotificationProvider";
import { getSession } from "@/lib/auth";
import { getRoleHomePath } from "@/lib/role-home";

export default async function CoordinatorLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();

  if (!session) {
    redirect("/");
  }

  if (session.role !== "coordinator" && session.role !== "admin") {
    redirect(getRoleHomePath(session.role));
  }

  return (
    <NotificationProvider>
      <div className="min-h-screen">
        <NavBar studentName={session.displayName} role={session.role} />
        <main
          id="main-content"
          className="min-h-screen overflow-y-auto overflow-x-hidden pb-24 pt-20 md:ml-[19rem] md:pb-10 md:pr-5 md:pt-5"
        >
          {children}
        </main>
      </div>
    </NotificationProvider>
  );
}
