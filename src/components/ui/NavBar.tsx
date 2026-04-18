"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { getRoleHomePath } from "@/lib/role-home";
import { type NavPhase, type NavItem } from "@/lib/nav-progression";
import { getVisibleNavItems, getVisibleSecondaryNavItems } from "@/lib/nav-items";
import {
  Users,
  Buildings,
  Gear,
  Wrench,
  ChatCircle,
  DotsThreeOutline,
  UserCircle,
  SignOut,
} from "@phosphor-icons/react";
import { ThemeToggle } from "./ThemeToggle";
import BrandLockup from "./BrandLockup";
import NotificationBell from "./NotificationBell";
import { SageMiniChat } from "@/components/chat/SageMiniChat";

const STAFF_ITEMS: NavItem[] = [
  { href: "/teacher/chat", label: "Sage", icon: ChatCircle, phase: 1 },
  { href: "/teacher", label: "Students", icon: Users, phase: 1 },
  { href: "/teacher/classes", label: "Classes", icon: Buildings, phase: 1 },
  { href: "/teacher/manage", label: "Program Setup", icon: Gear, phase: 1 },
];

const ADMIN_ITEMS: NavItem[] = [
  { href: "/admin/chat", label: "Sage", icon: ChatCircle, phase: 1 },
  { href: "/admin", label: "Admin", icon: Wrench, phase: 1 },
];

interface NavBarProps {
  studentName: string;
  role: string;
  navPhase?: NavPhase;
  orientationComplete?: boolean;
}

export default function NavBar({ studentName, role, navPhase, orientationComplete }: NavBarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [moreOpen, setMoreOpen] = useState(false);
  const [sageMiniOpen, setSageMiniOpen] = useState(false);
  const [sagePendingMessage, setSagePendingMessage] = useState<string | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);

  // Listen for sage:open events from anywhere in the app
  const handleSageOpen = useCallback((e: Event) => {
    const detail = (e as CustomEvent<{ message: string }>).detail;
    if (detail?.message) {
      setSagePendingMessage(detail.message);
      setSageMiniOpen(true);
    }
  }, []);

  useEffect(() => {
    window.addEventListener("sage:open", handleSageOpen);
    return () => window.removeEventListener("sage:open", handleSageOpen);
  }, [handleSageOpen]);
  const moreButtonRef = useRef<HTMLButtonElement>(null);
  const moreDialogRef = useRef<HTMLDivElement>(null);
  const profileButtonRef = useRef<HTMLButtonElement>(null);
  const profileMenuRef = useRef<HTMLDivElement>(null);

  const homeHref = getRoleHomePath(role);

  // Primary nav items for the sidebar
  const primaryItems =
    role === "student"
      ? getVisibleNavItems(navPhase ?? 3, orientationComplete)
      : role === "admin"
        ? [...ADMIN_ITEMS, ...STAFF_ITEMS]
        : STAFF_ITEMS;

  // Secondary nav items (student only)
  const secondaryItems =
    role === "student" ? getVisibleSecondaryNavItems(navPhase ?? 3) : [];

  // Mobile bottom bar: 5 slots — Home, Goals, Sage (center FAB), Learning, More
  // "More" sheet contains the rest: Career, Advising, Portfolio, Vision Board, Files, Resources, Settings
  const allStudentItems = [...getVisibleNavItems(navPhase ?? 3, orientationComplete), ...getVisibleSecondaryNavItems(navPhase ?? 3)];
  const mobileMain = role === "student"
    ? allStudentItems.slice(0, 2) // Home, Goals
    : primaryItems.slice(0, 2);

  const mobileLearningItem = role === "student"
    ? allStudentItems.find(i => i.href === "/learning")
    : primaryItems[2];

  // For student: Career, Advising, Portfolio, Vision Board, Files, Resources (skip Home, Goals, Learning)
  const mobileMore = role === "student"
    ? allStudentItems.filter(i => i.href !== "/dashboard" && i.href !== "/goals" && i.href !== "/learning")
    : primaryItems.slice(3);

  const handleLogout = async () => {
    await fetch("/api/auth/session", { method: "DELETE" });
    router.push("/");
    router.refresh();
  };

  // Click-outside handler for More sheet
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

  // Click-outside handler for profile menu
  useEffect(() => {
    if (!profileOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (
        profileMenuRef.current &&
        !profileMenuRef.current.contains(e.target as Node) &&
        profileButtonRef.current &&
        !profileButtonRef.current.contains(e.target as Node)
      ) {
        setProfileOpen(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setProfileOpen(false);
        profileButtonRef.current?.focus();
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [profileOpen]);

  // Longest-match-wins active detection — prevents `/teacher` from highlighting
  // when the user is on `/teacher/classes`. The set of candidates is every href
  // currently visible in the NavBar (primary + secondary + static links).
  const allNavHrefs = Array.from(
    new Set<string>([
      ...primaryItems.map((i) => i.href),
      ...secondaryItems.map((i) => i.href),
      "/settings",
      "/chat",
      "/teacher/chat",
      "/admin/chat",
    ]),
  );
  const isActive = (href: string): boolean => {
    const matches = allNavHrefs.filter(
      (h) => pathname === h || pathname.startsWith(h + "/"),
    );
    if (matches.length === 0) return false;
    const longest = matches.reduce((a, b) => (a.length >= b.length ? a : b));
    return longest === href;
  };

  const isMoreActive = mobileMore.some((item) => isActive(item.href));

  // Shared link renderer for sidebar nav items
  const renderSidebarLink = (item: NavItem, small?: boolean) => {
    const active = isActive(item.href);
    return (
      <Link
        key={item.href}
        href={item.href}
        prefetch={false}
        className={`mb-1 flex items-center gap-3 rounded-[1.15rem] px-4 ${small ? "py-2" : "py-3"} text-sm font-medium transition-colors ${
          active
            ? "bg-gradient-to-r from-[#37b550] to-[#2a8a3c] text-white shadow-[0_18px_36px_rgba(55,181,80,0.25)]"
            : "text-white/90 hover:bg-[var(--surface-raised)]/10 hover:text-white"
        }`}
        aria-current={active ? "page" : undefined}
      >
        <span
          aria-hidden="true"
          className={`grid ${small ? "h-8 w-8 rounded-xl" : "h-10 w-10 rounded-2xl"} place-items-center text-base ${
            active ? "bg-white/20 text-white" : "bg-[var(--surface-raised)]/10 text-white"
          }`}
        >
          <item.icon size={small ? 16 : 20} weight={active ? "fill" : "regular"} />
        </span>
        <span className={small ? "text-xs" : ""}>{item.label}</span>
      </Link>
    );
  };

  return (
    <>
      <div className="fixed left-3 right-3 top-3 z-50 flex items-center gap-3 rounded-[1.6rem] border border-[var(--border)] bg-[var(--surface-base)]/95 px-3.5 py-3 shadow-[var(--shadow-card)] backdrop-blur-xl md:hidden">
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
          <ThemeToggle className="hidden min-[390px]:block" />
          <div className="text-[var(--ink-strong)]">
            <NotificationBell />
          </div>
          <button
            onClick={handleLogout}
            type="button"
            className="rounded-full border border-[var(--border)] px-3 py-2 text-xs font-semibold text-[var(--ink-muted)] transition-colors hover:bg-[var(--surface-overlay)] hover:text-[var(--ink-strong)]"
            aria-label="Log out"
          >
            Log out
          </button>
        </div>
      </div>

      <nav
        className="fixed bottom-0 left-0 right-0 z-50 border-t border-[var(--border)] bg-[var(--surface-base)]/95 backdrop-blur-xl md:hidden"
        role="navigation"
        aria-label="Main navigation"
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      >
        <div className="flex items-end justify-around px-2 pt-1.5 pb-2">
          {/* Tab 1: Home */}
          {mobileMain[0] && (() => {
            const item = mobileMain[0];
            const IconComponent = item.icon;
            const active = isActive(item.href);
            return (
              <Link href={item.href} prefetch={false} className="flex flex-col items-center gap-0.5 px-3 py-2.5" aria-current={active ? "page" : undefined}>
                <IconComponent size={22} weight={active ? "fill" : "regular"} className={active ? "text-[var(--accent-green)]" : "text-[var(--ink-faint)]"} />
                <span className={`text-xs font-medium ${active ? "text-[var(--accent-green)]" : "text-[var(--ink-faint)]"}`}>{item.label}</span>
                {active && <div className="mt-0.5 h-1 w-1 rounded-full bg-[var(--accent-green)]" />}
              </Link>
            );
          })()}

          {/* Tab 2: Goals */}
          {mobileMain[1] && (() => {
            const item = mobileMain[1];
            const IconComponent = item.icon;
            const active = isActive(item.href);
            return (
              <Link href={item.href} prefetch={false} className="flex flex-col items-center gap-0.5 px-3 py-2.5" aria-current={active ? "page" : undefined}>
                <IconComponent size={22} weight={active ? "fill" : "regular"} className={active ? "text-[var(--accent-green)]" : "text-[var(--ink-faint)]"} />
                <span className={`text-xs font-medium ${active ? "text-[var(--accent-green)]" : "text-[var(--ink-faint)]"}`}>{item.label}</span>
                {active && <div className="mt-0.5 h-1 w-1 rounded-full bg-[var(--accent-green)]" />}
              </Link>
            );
          })()}

          {/* Tab 3: Sage — elevated center FAB */}
          <Link
            href="/chat"
            prefetch={false}
            className="flex flex-col items-center gap-0.5 px-3"
            aria-label="Open Sage chat"
          >
            <div className={`-mt-4 grid h-11 w-11 place-items-center rounded-full bg-gradient-to-br from-[#37b550] to-[#2a8a3c] text-white shadow-[0_4px_16px_var(--glow-green)] transition-transform active:scale-95 ${pathname === "/chat" ? "animate-glow-pulse" : ""}`}>
              <ChatCircle size={22} weight="fill" />
            </div>
            <span className={`text-xs font-medium ${pathname === "/chat" ? "text-[var(--accent-green)]" : "text-[var(--ink-faint)]"}`}>Sage</span>
          </Link>

          {/* Tab 4: Learning */}
          {mobileLearningItem && (() => {
            const item = mobileLearningItem;
            const IconComponent = item.icon;
            const active = isActive(item.href);
            return (
              <Link href={item.href} prefetch={false} className="flex flex-col items-center gap-0.5 px-3 py-2.5" aria-current={active ? "page" : undefined}>
                <IconComponent size={22} weight={active ? "fill" : "regular"} className={active ? "text-[var(--accent-green)]" : "text-[var(--ink-faint)]"} />
                <span className={`text-xs font-medium ${active ? "text-[var(--accent-green)]" : "text-[var(--ink-faint)]"}`}>{item.label}</span>
                {active && <div className="mt-0.5 h-1 w-1 rounded-full bg-[var(--accent-green)]" />}
              </Link>
            );
          })()}

          {/* Tab 5: More */}
          <button
            ref={moreButtonRef}
            onClick={() => setMoreOpen(!moreOpen)}
            type="button"
            className="flex flex-col items-center gap-0.5 px-3 py-2.5"
            aria-expanded={moreOpen}
            aria-haspopup="dialog"
            aria-label="More navigation options"
          >
            <DotsThreeOutline size={22} weight={isMoreActive ? "fill" : "regular"} className={isMoreActive ? "text-[var(--accent-green)]" : "text-[var(--ink-faint)]"} />
            <span className={`text-xs font-medium ${isMoreActive ? "text-[var(--accent-green)]" : "text-[var(--ink-faint)]"}`}>More</span>
            {isMoreActive && <div className="mt-0.5 h-1 w-1 rounded-full bg-[var(--accent-green)]" />}
          </button>
        </div>
      </nav>

      {moreOpen && (mobileMore.length > 0 || role === "student") ? (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/30 md:hidden"
            onClick={() => setMoreOpen(false)}
          />
          <div
            ref={moreDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="more-nav-title"
            className="panel panel-strong fixed bottom-16 left-3 right-3 z-50 rounded-[1.75rem] p-4 md:hidden"
          >
            <h2 id="more-nav-title" className="sr-only">Navigation menu</h2>
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
              {mobileMore.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  prefetch={false}
                  onClick={() => setMoreOpen(false)}
                  className={`flex min-w-0 flex-col items-center rounded-[1.1rem] px-1 py-3 text-xs transition-colors ${
                    isActive(item.href)
                      ? "bg-[var(--surface-overlay)] text-[var(--ink-strong)]"
                      : "text-[var(--ink-muted)] hover:bg-[var(--surface-overlay)]"
                  }`}
                  aria-current={isActive(item.href) ? "page" : undefined}
                >
                  <item.icon size={24} weight="regular" className="mb-1" />
                  <span className="text-center leading-4">{item.label}</span>
                </Link>
              ))}
              {/* Settings in More sheet for students */}
              {role === "student" && (
                <Link
                  href="/settings"
                  prefetch={false}
                  onClick={() => setMoreOpen(false)}
                  className={`flex min-w-0 flex-col items-center rounded-[1.1rem] px-1 py-3 text-xs transition-colors ${
                    isActive("/settings")
                      ? "bg-[var(--surface-overlay)] text-[var(--ink-strong)]"
                      : "text-[var(--ink-muted)] hover:bg-[var(--surface-overlay)]"
                  }`}
                  aria-current={isActive("/settings") ? "page" : undefined}
                >
                  <Gear size={24} weight="regular" className="mb-1" />
                  <span className="text-center leading-4">Settings</span>
                </Link>
              )}
            </div>
          </div>
        </>
      ) : null}

      <aside
        // Always-dark sidebar gradient — intentional raw rgba for the navy→teal ramp.
        // eslint-disable-next-line no-restricted-syntax
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
          {/* Primary nav items */}
          {primaryItems.map((item) => renderSidebarLink(item))}

          {/* Secondary nav items (student only) with visual separator */}
          {secondaryItems.length > 0 && (
            <>
              <div className="my-3 border-t border-white/10" />
              {secondaryItems.map((item) => renderSidebarLink(item, true))}
            </>
          )}
        </nav>

        <div className="relative border-t border-white/10 p-4">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <p className="break-words text-sm font-semibold leading-5">{studentName}</p>
              <p className="text-xs uppercase tracking-[0.18em] text-white/75">{role}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <NotificationBell />
              <button
                ref={profileButtonRef}
                onClick={() => setProfileOpen(!profileOpen)}
                type="button"
                className="rounded-full border border-white/12 p-1.5 text-white/90 transition-colors hover:bg-[var(--surface-raised)]/10 hover:text-white"
                aria-label="Profile menu"
                aria-expanded={profileOpen}
                aria-haspopup="menu"
              >
                <UserCircle size={20} weight="bold" />
              </button>
            </div>
          </div>

          {/* Profile dropdown menu */}
          {profileOpen && (
            <div
              ref={profileMenuRef}
              role="menu"
              className="absolute bottom-full left-4 right-4 mb-2 rounded-2xl border border-white/10 bg-[rgba(7,23,43,0.98)] p-3 shadow-[0_16px_40px_rgba(0,0,0,0.4)] backdrop-blur-xl"
            >
              <p className="mb-2 break-words px-2 text-sm font-semibold text-white">
                {studentName}
              </p>
              {role === "student" && (
                <Link
                  href="/settings"
                  prefetch={false}
                  onClick={() => setProfileOpen(false)}
                  className="flex items-center gap-2.5 rounded-xl px-2 py-2 text-sm text-white/90 transition-colors hover:bg-[var(--surface-raised)]/10 hover:text-white"
                  role="menuitem"
                >
                  <Gear size={16} weight="regular" />
                  Settings
                </Link>
              )}
              <div className="flex items-center gap-2.5 rounded-xl px-2 py-2">
                <ThemeToggle />
                <span className="text-sm text-white/75">Theme</span>
              </div>
              <button
                onClick={() => {
                  setProfileOpen(false);
                  handleLogout();
                }}
                type="button"
                className="flex w-full items-center gap-2.5 rounded-xl px-2 py-2 text-sm text-white/90 transition-colors hover:bg-[var(--surface-raised)]/10 hover:text-white"
                role="menuitem"
              >
                <SignOut size={16} weight="regular" />
                Log out
              </button>
            </div>
          )}
        </div>
      </aside>

      {/* Floating Sage button + mini chat */}
      {pathname !== "/chat" && pathname !== "/teacher/chat" && pathname !== "/admin/chat" && (
        <>
          <button
            onClick={() => setSageMiniOpen((v) => !v)}
            type="button"
            className={`fixed bottom-6 right-6 z-50 hidden h-14 w-14 items-center justify-center rounded-full text-2xl text-[#f0efe8] shadow-[0_8px_30px_var(--glow-green)] transition-all hover:scale-110 md:flex ${sageMiniOpen ? "bg-[rgba(8,68,80,0.95)]" : "bg-gradient-to-br from-[#37b550] to-[#2a8a3c]"}`}
            aria-label={sageMiniOpen ? "Close Sage chat" : "Open Sage chat"}
            aria-expanded={sageMiniOpen}
          >
            {sageMiniOpen ? "✕" : <ChatCircle size={24} weight="fill" />}
          </button>
          <SageMiniChat
            open={sageMiniOpen}
            onClose={() => setSageMiniOpen(false)}
            role={role}
            initialMessage={sagePendingMessage}
            onInitialMessageConsumed={() => setSagePendingMessage(null)}
          />
        </>
      )}
    </>
  );
}
