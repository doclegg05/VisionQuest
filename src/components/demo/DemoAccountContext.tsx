"use client";

import { createContext, useContext } from "react";
import type { DemoAccountKind } from "@/lib/demo/config";

/**
 * Which kind of cohort demo account is signed in, for client components.
 *
 * The student layout is a server component that already holds the session, so
 * it passes the kind down as a plain prop to this provider. Anywhere without a
 * provider (the teacher and admin sides) reads `null`, which is also what a
 * real account reads, so a component that checks for "student" shows nothing
 * on those sides without knowing about them.
 */
const DemoAccountContext = createContext<DemoAccountKind | null>(null);

export function DemoAccountProvider({
  value,
  children,
}: {
  value: DemoAccountKind | null;
  children: React.ReactNode;
}) {
  return <DemoAccountContext.Provider value={value}>{children}</DemoAccountContext.Provider>;
}

export function useDemoAccount(): DemoAccountKind | null {
  return useContext(DemoAccountContext);
}
