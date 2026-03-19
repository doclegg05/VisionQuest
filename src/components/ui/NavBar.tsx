"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import BrandLockup from "./BrandLockup";
import NotificationBell from "./NotificationBell";

const NAV_ITEMS = [
  { href: "/chat", label: "Sage", icon: "💬" },
  { href: "/dashboard", label: "Dashboard", icon: "📊" },
  { href: "/appointments", label: "Advising", icon: "🗓️" },
  { href: "/goals", label: "Goals", icon: "🎯" },
  { href: "/orientation", label: "Orientation", icon: "📋" },
  { href: "/spokes", label: "SPOKES", icon: "🧭" },
  { href: "/courses", label: "Courses", icon: "📚" },
  { href: "/resources", label: "Resources", icon: "📄" },
  { href: "/opportunities", label: "Jobs", icon: "🚀" },
  { href: "/events", label: "Events", icon: "🎟️" },
  { href: "/certifications", label: "Certs", icon: "🏆" },
  { href: "/portfolio", label: "Portfolio", icon: "💼" },
  { href: "/vision-board", label: "Vision Board", icon: "📌" },
  { href: "/files", label: "Files", icon: "📁" },
  { href: "/settings", label: "Settings", icon: "⚙️" },
];

const TEACHER_ITEMS = [
  { href: "/teacher", label: "Class Dashboard", icon: "👥" },
  { href: "/teacher/manage", label: "Manage Content", icon: "⚙️" },
];

const MOBILE_MAIN = NAV_ITEMS.slice(0, 4);
const MOBILE_MORE = NAV_ITEMS.slice(4);

interface NavBarProps {
  studentName: string;
  role: string;
}

export default function NavBar({ studentName, role }: NavBarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [moreOpen, setMoreOpen] = useState(false);

  const handleLogout = async () => {
    await fetch("/api/auth/session", { method: "DELETE" });
    router.push("/");
    router.refresh();
  };

  useEffect(() => {
    if (!moreOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMoreOpen(false);
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [moreOpen]);

  const isMoreActive = [...MOBILE_MORE, ...(role === "teacher" ? TEACHER_ITEMS : [])].some(
    (item) => pathname === item.href || pathname.startsWith(item.href + "/")
  );

  return (
    <>
      <div className="md:hidden fixed left-3 right-3 top-3 z-50 flex items-center justify-between rounded-[1.6rem] border border-white/50 bg-[rgba(255,255,255,0.84)] px-4 py-3 shadow-[0_16px_40px_rgba(16,37,62,0.12)] backdrop-blur">
        <BrandLockup
          href="/dashboard"
          size="sm"
          title="VisionQuest"
          subtitle="SPOKES Portal"
        />
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-[var(--ink-muted)]">{studentName}</span>
          <div className="text-[var(--ink-strong)]">
            <NotificationBell />
          </div>
          <button
            onClick={handleLogout}
            type="button"
            className="rounded-full border border-[rgba(18,38,63,0.1)] px-3 py-1 text-xs font-semibold text-[var(--ink-muted)] transition-colors hover:bg-[rgba(16,37,62,0.04)] hover:text-[var(--ink-strong)]"
            aria-label="Log out"
          >
            Log out
          </button>
        </div>
      </div>

      <nav
        className="md:hidden fixed bottom-3 left-3 right-3 z-50 rounded-[1.8rem] border border-white/55 bg-[rgba(255,255,255,0.84)] shadow-[0_18px_50px_rgba(16,37,62,0.16)] backdrop-blur"
        role="navigation"
        aria-label="Main navigation"
      >
        <div className="flex">
          {MOBILE_MAIN.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              prefetch={false}
              className={`flex flex-1 flex-col items-center py-3 text-xs transition-colors
                ${pathname === item.href ? "text-[var(--ink-strong)]" : "text-[var(--ink-muted)]"}`}
              aria-current={pathname === item.href ? "page" : undefined}
            >
              <span className={`mb-1 grid h-9 w-9 place-items-center rounded-2xl text-lg ${
                pathname === item.href ? "bg-[rgba(16,37,62,0.1)]" : "bg-transparent"
              }`}>
                {item.icon}
              </span>
              <span>{item.label}</span>
            </Link>
          ))}
          <button
            onClick={() => setMoreOpen(!moreOpen)}
            type="button"
            className={`flex flex-1 flex-col items-center py-3 text-xs transition-colors
              ${isMoreActive ? "text-[var(--ink-strong)]" : "text-[var(--ink-muted)]"}`}
            aria-expanded={moreOpen}
            aria-label="More navigation options"
          >
            <span className={`mb-1 grid h-9 w-9 place-items-center rounded-2xl text-lg ${
              isMoreActive ? "bg-[rgba(16,37,62,0.1)]" : "bg-transparent"
            }`}>
              •••
            </span>
            <span>More</span>
          </button>
        </div>
      </nav>

      {moreOpen && (
        <>
          <div
            className="md:hidden fixed inset-0 z-40 bg-black/30"
            onClick={() => setMoreOpen(false)}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="More navigation options"
            className="panel panel-strong md:hidden fixed bottom-24 left-3 right-3 z-50 rounded-[1.75rem] p-4"
          >
            <div className="grid grid-cols-4 gap-3">
              {MOBILE_MORE.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  prefetch={false}
                  onClick={() => setMoreOpen(false)}
                  className={`flex flex-col items-center rounded-[1.1rem] py-3 text-xs transition-colors
                    ${pathname === item.href
                      ? "bg-[rgba(16,37,62,0.08)] text-[var(--ink-strong)]"
                      : "text-[var(--ink-muted)] hover:bg-[rgba(16,37,62,0.04)]"
                    }`}
                  aria-current={pathname === item.href ? "page" : undefined}
                >
                  <span className="mb-1 text-2xl">{item.icon}</span>
                  <span>{item.label}</span>
                </Link>
              ))}
            </div>
            {role === "teacher" && (
              <div className="mt-3 grid grid-cols-2 gap-3 border-t border-[rgba(18,38,63,0.08)] pt-3">
                {TEACHER_ITEMS.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    prefetch={false}
                    onClick={() => setMoreOpen(false)}
                    className={`flex items-center gap-2 rounded-[1rem] px-4 py-3 text-sm transition-colors
                      ${pathname === item.href || pathname.startsWith(item.href + "/")
                        ? "bg-[rgba(16,37,62,0.08)] text-[var(--ink-strong)]"
                        : "text-[var(--ink-muted)] hover:bg-[rgba(16,37,62,0.04)]"}`}
                    aria-current={pathname === item.href ? "page" : undefined}
                  >
                    <span>{item.icon}</span>
                    <span>{item.label}</span>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      <aside
        className="hidden md:flex fixed inset-y-4 left-4 z-40 w-[17rem] flex-col overflow-hidden rounded-[2rem] border border-[var(--border-strong)] bg-[linear-gradient(180deg,rgba(7,23,43,0.96),rgba(16,37,62,0.94)_34%,rgba(8,68,80,0.92))] text-white shadow-[0_30px_90px_rgba(7,23,43,0.28)]"
        role="navigation"
        aria-label="Main navigation"
      >
        <div className="border-b border-white/10 p-6">
          <BrandLockup
            href="/dashboard"
            size="md"
            title="VisionQuest"
            subtitle="SPOKES Program Portal"
            theme="dark"
          />
          <p className="mt-4 text-sm leading-6 text-white/68">
            A guided path from big vision to daily wins.
          </p>
        </div>

        <nav className="flex-1 overflow-y-auto p-4">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              prefetch={false}
              className={`mb-1 flex items-center gap-3 rounded-[1.15rem] px-4 py-3 text-sm font-medium transition-colors
                ${pathname === item.href
                  ? "bg-white text-[var(--ink-strong)] shadow-[0_18px_36px_rgba(255,255,255,0.12)]"
                  : "text-white/72 hover:bg-white/10 hover:text-white"
                }`}
              aria-current={pathname === item.href ? "page" : undefined}
            >
              <span className={`grid h-10 w-10 place-items-center rounded-2xl text-base ${
                pathname === item.href ? "bg-[var(--ink-strong)] text-white" : "bg-white/10 text-white"
              }`}>
                {item.icon}
              </span>
              <span>{item.label}</span>
            </Link>
          ))}

          {role === "teacher" && (
            <div className="mt-4 border-t border-white/10 pt-4">
              {TEACHER_ITEMS.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  prefetch={false}
                  className={`mb-1 flex items-center gap-3 rounded-[1.15rem] px-4 py-3 text-sm font-medium transition-colors
                    ${pathname === item.href || pathname.startsWith(item.href + "/")
                      ? "bg-white text-[var(--ink-strong)] shadow-[0_18px_36px_rgba(255,255,255,0.12)]"
                      : "text-white/72 hover:bg-white/10 hover:text-white"
                    }`}
                  aria-current={pathname === item.href ? "page" : undefined}
                >
                  <span className={`grid h-10 w-10 place-items-center rounded-2xl text-base ${
                    pathname === item.href || pathname.startsWith(item.href + "/")
                      ? "bg-[var(--ink-strong)] text-white"
                      : "bg-white/10 text-white"
                  }`}>
                    {item.icon}
                  </span>
                  <span>{item.label}</span>
                </Link>
              ))}
            </div>
          )}
        </nav>

        <div className="border-t border-white/10 p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold">{studentName}</p>
              <p className="text-xs uppercase tracking-[0.18em] text-white/45">{role}</p>
            </div>
            <div className="flex items-center gap-2">
              <NotificationBell />
              <button
                onClick={handleLogout}
                type="button"
                className="rounded-full border border-white/12 px-3 py-1 text-xs font-semibold text-white/65 transition-colors hover:bg-white/10 hover:text-white"
                aria-label="Log out"
              >
                Log out
              </button>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}
