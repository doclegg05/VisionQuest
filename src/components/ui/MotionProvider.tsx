"use client";

import { MotionConfig } from "framer-motion";
import type { ReactNode } from "react";

/**
 * Makes every framer-motion animation follow the system Reduce Motion
 * setting. The CSS reduced-motion block in globals.css does not reach
 * animations framer runs in JavaScript.
 */
export function MotionProvider({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
