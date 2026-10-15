/**
 * Browser harness for the vision board. e2e/vision-board-undo.spec.ts bundles
 * this with esbuild and the app's compiled stylesheet. The API is stubbed with
 * one note pin; no app server or login is involved.
 */
import { createRoot } from "react-dom/client";
import VisionBoard, { type VisionBoardItemData } from "@/components/vision-board/VisionBoard";

const pin: VisionBoardItemData = {
  id: "pin-1", type: "note", content: "Get my CDL by June", fileId: null, goalId: null,
  posX: 40, posY: 40, width: 220, rotation: 0, color: null, pinColor: "red", zIndex: 1,
};

window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (url.startsWith("/api/vision-board") && (init?.method ?? "GET") === "GET") {
    return new Response(JSON.stringify({ items: [pin] }), { status: 200 });
  }
  return new Response(JSON.stringify({}), { status: 200 });
};

createRoot(document.getElementById("root")!).render(<VisionBoard />);
