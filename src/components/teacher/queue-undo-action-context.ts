"use client";

import { createContext } from "react";

/**
 * Undo for the alert line that offers it. The intervention queue provides it beside `QueueUndoLineContext`, so the
 * rows in between need no new props. Outside a provider no line offers Undo, so this is never called.
 */
export const QueueUndoActionContext = createContext<() => void>(() => {});
