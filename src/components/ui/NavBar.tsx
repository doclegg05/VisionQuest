"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { getRoleHomePath } from "@/lib/role-home";
import { getVisibleNavItems, type NavPhase } from "@/lib/nav-progression";
import BrandLockup from "./BrandLockup";
import NotificationBell from "./NotificationBell";
import { SageMiniChat } from "@/components/chat/SageMiniChat";

const STAFF_ITEMS = [
  { href: "/teacher", label: "Class Dashboard", icon: "👥" },
  { href: "/teacher/classes", label: "Classes", icon: "🏫" },
  { href: "/teacher/manage", label: "Manage Content", icon: "⚙️" },
];

const ADMIN_ITEMS = [
  { href: "/admin", label: "Admin", icon: "🛠️" },
];

interface NavBarProps {
  studentName: string;
  role: string;
  navPhase?: NavPhase;
}

export default function NavBar({ studentName, role, navPhase }: NavBarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [moreOpen, setMoreOpen] = useState(false);
  const [sageMiniOpen, setSageMiniOpen] = useState(false);
  const moreButtonRef = useRef<HTMLButtonElement>(null);
  const moreDialogRef = useRef<HTMLDivElement>(null);

  const homeHref = getRoleHomePath(role);
  const primaryItems =
    role === "student"
      ? getVisibleNavItems(navPhase ?? 3)
      : role === "admin"
        ? [...ADMIN_ITEMS, ...STAFF_ITEMS]
        : STAFF_ITEMS;
  const mobileMain = primaryItems.slice(0, 4);
  const mobileMore = primaryItems.slice(4);

  const handleLogout = async () => {
    await fetch("/api/auth/session", { method: "DELETE" });
    router.push("/");
    router.refresh();
  };

  useEffect(() => {
    if (!moreOpen) return;
    const first = moreDialogRef.current?.querySelector<HTMLElement>("a, button");
    if (first) first.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMoreOpen(false);
        moreButtonRef.current?.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [moreOpen]);

  const isMoreActive = mobileMore.some(
    (item) => pathname === item.href || pathname.startsWith(item.href + "/"),
  );

  return (
    <>
      <div className="fixed left-3 right-3 top-3 z-50 flex items-center gap-3 rounded-[1.6rem] border border-white/50 bg-[rgba(255,255,255,0.84)] px-3.5 py-3 shadow-[0_16px_40px_rgba(16,37,62,0.12)] backdrop-blur md:hidden">
        <div className="min-w-0 flex-1">
          <BrandLockup
            href={homeHref}
            size="sm"
            title="VisionQuest"
            subtitle="Portal"
          />
        </div>
        <div className="flex shrink-0 items-center gap-1.5 min-[430px]:gap-2">
          <span className="hidden max-w-[9.75rem] break-words text-right text-sm font-medium leading-4 text-[var(--ink-muted)] min-[430px]:block min-[470px]:max-w-[11rem]">
            {studentName}
          </span>
          <div className="text-[var(--ink-strong)]">
            <NotificationBell />
          </div>
          {role === "student" && (
            <Link
              href="/settings"
              prefetch={false}
              className="rounded-full border border-[rgba(18,38,63,0.1)] px-2.5 py-1 text-[11px] font-semibold text-[var(--ink-muted)] transition-colors hover:bg-[rgba(16,37,62,0.04)] hover:text-[var(--ink-strong)]"
              aria-label="Settings"
            >
              ⚙️
            </Link>
          )}
          <button
            onClick={handleLogout}
            type="button"
            className="rounded-full border border-[rgba(18,38,63,0.1)] px-2.5 py-1 text-[11px] font-semibold text-[var(--ink-muted)] transition-colors hover:bg-[rgba(16,37,62,0.04)] hover:text-[var(--ink-strong)] min-[390px]:text-xs"
            aria-label="Log out"
          >
            Log out
          </button>
        </div>
      </div>

      <nav
        className="fixed bottom-3 left-3 right-3 z-50 rounded-[1.8rem] border border-white/55 bg-[rgba(255,255,255,0.84)] shadow-[0_18px_50px_rgba(16,37,62,0.16)] backdrop-blur md:hidden"
        role="navigation"
        aria-label="Main navigation"
      >
        <div className="flex">
          {mobileMain.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              prefetch={false}
              className={`flex min-w-0 flex-1 flex-col items-center px-1 py-3 text-[11px] leading-4 transition-colors ${
                pathname === item.href || pathname.startsWith(item.href + "/")
                  ? "text-[var(--ink-strong)]"
                  : "text-[var(--ink-muted)]"
              }`}
              aria-current={pathname === item.href ? "page" : undefined}
            >
              <span
                className={`mb-1 grid h-9 w-9 place-items-center rounded-2xl text-lg ${
                  pathname === item.href || pathname.startsWith(item.href + "/")
                    ? "bg-[rgba(16,37,62,0.1)]"
                    : "bg-transparent"
                }`}
              >
                {item.icon}
              </span>
              <span className="text-center">{item.label}</span>
            </Link>
          ))}
          {mobileMore.length > 0 ? (
            <button
              ref={moreButtonRef}
              onClick={() => setMoreOpen(!moreOpen)}
              type="button"
              className={`flex min-w-0 flex-1 flex-col items-center px-1 py-3 text-[11px] leading-4 transition-colors ${
                isMoreActive ? "text-[var(--ink-strong)]" : "text-[var(--ink-muted)]"
              }`}
              aria-expanded={moreOpen}
              aria-haspopup="dialog"
              aria-label="More navigation options"
            >
              <span
                className={`mb-1 grid h-9 w-9 place-items-center rounded-2xl text-lg ${
                  isMoreActive ? "bg-[rgba(16,37,62,0.1)]" : "bg-transparent"
                }`}
              >
                •••
              </span>
              <span className="text-center">More</span>
            </button>
          ) : null}
        </div>
      </nav>

      {moreOpen && mobileMore.length > 0 ? (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/30 md:hidden"
            onClick={() => setMoreOpen(false)}
          />
          <div
            ref={moreDialogRef}
            role="dialog"
            aria-modal="true"
            aria-label="More navigation options"
            className="panel panel-strong fixed bottom-24 left-3 right-3 z-50 rounded-[1.75rem] p-4 md:hidden"
          >
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
              {mobileMore.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  prefetch={false}
                  onClick={() => setMoreOpen(false)}
                  className={`flex min-w-0 flex-col items-center rounded-[1.1rem] px-1 py-3 text-xs transition-colors ${
                    pathname === item.href || pathname.startsWith(item.href + "/")
                      ? "bg-[rgba(16,37,62,0.08)] text-[var(--ink-strong)]"
                      : "text-[var(--ink-muted)] hover:bg-[rgba(16,37,62,0.04)]"
                  }`}
                  aria-current={pathname === item.href ? "page" : undefined}
                >
                  <span className="mb-1 text-2xl">{item.icon}</span>
                  <span className="text-center leading-4">{item.label}</span>
                </Link>
              ))}
            </div>
          </div>
        </>
      ) : null}

      <aside
        className="fixed inset-y-4 left-4 z-40 hidden w-[17rem] flex-col overflow-hidden rounded-[2rem] border border-[var(--border-strong)] bg-[linear-gradient(180deg,rgba(7,23,43,0.96),rgba(16,37,62,0.94)_34%,rgba(8,68,80,0.92))] text-white shadow-[0_30px_90px_rgba(7,23,43,0.28)] md:flex"
        role="navigation"
        aria-label="Main navigation"
      >
        <div className="border-b border-white/10 p-6">
          <BrandLockup
            href={homeHref}
            size="md"
            title="VisionQuest"
            subtitle="SPOKES Program Portal"
            theme="dark"
          />
          <p className="mt-4 text-sm leading-6 text-white/90">
            A guided path from big vision to daily wins.
          </p>
        </div>

        <nav className="flex-1 overflow-y-auto p-4">
          {primaryItems.map((item) => {
            const active = pathname === item.href || pathname.startsWith(item.href + "/");
            return (
              <Link
                key={item.href}
                href={item.href}
                prefetch={false}
                className={`mb-1 flex items-center gap-3 rounded-[1.15rem] px-4 py-3 text-sm font-medium transition-colors ${
                  active
                    ? "bg-white text-[var(--ink-strong)] shadow-[0_18px_36px_rgba(255,255,255,0.12)]"
                    : "text-white/90 hover:bg-white/10 hover:text-white"
                }`}
                aria-current={pathname === item.href ? "page" : undefined}
              >
                <span
                  aria-hidden="true"
                  className={`grid h-10 w-10 place-items-center rounded-2xl text-base ${
                    active ? "bg-[var(--ink-strong)] text-white" : "bg-white/10 text-white"
                  }`}
                >
                  {item.icon}
                </span>
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-white/10 p-4">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <p className="break-words text-sm font-semibold leading-5">{studentName}</p>
              <p className="text-xs uppercase tracking-[0.18em] text-white/75">{role}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <NotificationBell />
              {role === "student" && (
                <Link
                  href="/settings"
                  prefetch={false}
                  className="rounded-full border border-white/12 px-3 py-1 text-xs font-semibold text-white/90 transition-colors hover:bg-white/10 hover:text-white"
                  aria-label="Settings"
                >
                  ⚙️
                </Link>
              )}
              <button
                onClick={handleLogout}
                type="button"
                className="rounded-full border border-white/12 px-3 py-1 text-xs font-semibold text-white/90 transition-colors hover:bg-white/10 hover:text-white"
                aria-label="Log out"
              >
                Log out
              </button>
            </div>
          </div>
        </div>
      </aside>

      {/* Floating Sage button + mini chat for students */}
      {role === "student" && pathname !== "/chat" && (
        <>
          <button
            onClick={() => setSageMiniOpen((v) => !v)}
            type="button"
            className={`fixed bottom-20 right-4 z-50 flex h-14 w-14 items-center justify-center rounded-full text-2xl text-white shadow-[0_8px_30px_rgba(7,23,43,0.35)] transition-all hover:scale-110 md:bottom-6 md:right-6 ${sageMiniOpen ? "bg-[rgba(8,68,80,0.95)] rotate-0" : "bg-[var(--ink-strong)]"}`}
            aria-label={sageMiniOpen ? "Close Sage chat" : "Open Sage chat"}
            aria-expanded={sageMiniOpen}
          >
            {sageMiniOpen ? "✕" : "💬"}
          </button>
          <SageMiniChat open={sageMiniOpen} onClose={() => setSageMiniOpen(false)} />
        </>
      )}
    </>
  );
}
