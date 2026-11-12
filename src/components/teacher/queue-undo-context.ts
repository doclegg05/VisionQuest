"use client";

import { createContext } from "react";
import type { AlertLineState } from "./queue-undo";

const ALWAYS_ACTIONS: AlertLineState = { kind: "actions" };

/**
 * Tells each alert line whether it is acted on. The intervention queue provides it, so the rows in between need no
 * new props. Outside a provider every line shows its actions.
 */
export const QueueUndoLineContext = createContext<(alertId: string) => AlertLineState>(() => ALWAYS_ACTIONS);
