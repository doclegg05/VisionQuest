import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getRoleHomePath } from "@/lib/role-home";
import NavBar from "@/components/ui/NavBar";
import NotificationProvider from "@/components/ui/NotificationProvider";

export default async function TeacherLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();

  if (!session) {
    redirect("/");
  }

  if (session.role !== "teacher" && session.role !== "admin") {
    redirect(getRoleHomePath(session.role));
  }

  return (
    <NotificationProvider>
      <div className="app-frame min-h-screen">
        <NavBar studentName={session.displayName} role={session.role} />
        <main
          id="main-content"
          className="app-main min-h-screen overflow-y-auto overflow-x-hidden pb-24 pt-20 md:ml-[19rem] md:pb-10 md:pr-5 md:pt-5"
        >
          {session.demoAccount === "instructor" && (
            <aside className="mb-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 text-sm text-[var(--ink-strong)]" aria-label="Demo guide">
              <p className="font-semibold">Instructor and administrator demo</p>
              <p>This is a shared demo with made-up students. Start with Students, open a record, then try Sage. Other visitors can see demo notes and chats. Use made-up details only.</p>
              <p className="mt-2">Program-wide changes and account passwords are locked. Sage handles one reply at a time, so a busy demo may take over a minute. Please wait for your reply before sending again.</p>
            </aside>
          )}
          {children}
        </main>
      </div>
    </NotificationProvider>
  );
}
