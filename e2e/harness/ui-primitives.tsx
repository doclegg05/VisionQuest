/**
 * Browser harness for the shared UI primitives. e2e/ui-primitives.spec.ts
 * bundles this with esbuild and serves it to a real browser, so dialog and
 * timer behavior is tested without the app server or a login.
 */
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { useConfirm } from "@/components/ui/useConfirm";
import { useUndo } from "@/components/ui/useUndo";
import { FormDialog } from "@/components/ui/FormDialog";

function PromptCase() {
  const { prompt, confirmDialog } = useConfirm();
  const [result, setResult] = useState("unset");
  return (
    <section>
      <button
        id="open-prompt"
        onClick={async () => {
          const note = await prompt({ title: "Return this form?", label: "Note for the student (optional)", confirmLabel: "Return form" });
          setResult(note === null ? "null" : `text:${note}`);
        }}
      >
        Return form
      </button>
      <output id="prompt-result">{result}</output>
      {confirmDialog}
    </section>
  );
}

function OverlapCase() {
  const { confirm, confirmDialog } = useConfirm();
  const [log, setLog] = useState("");
  return (
    <section>
      <button
        id="overlap"
        onClick={() => {
          void confirm({ title: "First?", confirmLabel: "Yes" }).then((v) => setLog((l) => `${l}first:${v};`));
          void confirm({ title: "Second?", confirmLabel: "Yes" }).then((v) => setLog((l) => `${l}second:${v};`));
        }}
      >
        Two confirms
      </button>
      <output id="overlap-log">{log}</output>
      {confirmDialog}
    </section>
  );
}

function UnmountChild({ onSettled }: { onSettled: (v: string) => void }) {
  const { confirm, confirmDialog } = useConfirm();
  return (
    <>
      <button id="confirm-then-unmount" onClick={() => void confirm({ title: "Leaving?", confirmLabel: "Leave" }).then((v) => onSettled(String(v)))}>
        Ask
      </button>
      {confirmDialog}
    </>
  );
}

function UnmountCase() {
  const [mounted, setMounted] = useState(true);
  const [settled, setSettled] = useState("pending");
  return (
    <section>
      {mounted && <UnmountChild onSettled={setSettled} />}
      <button id="unmount-child" onClick={() => setMounted(false)}>
        Unmount
      </button>
      <output id="unmount-settled">{settled}</output>
    </section>
  );
}

function UndoCase() {
  const { scheduleRemoval, undoToast } = useUndo();
  const [visible, setVisible] = useState(true);
  const [commits, setCommits] = useState(0);
  return (
    <section>
      {visible && (
        <p id="pin">
          Pin: dream job{" "}
          <button
            id="remove-pin"
            onClick={() => {
              // The pin and its own Remove button disappear together, as in a real list row.
              setVisible(false);
              scheduleRemoval({
                label: "Pin removed.",
                restoredLabel: "Pin restored.",
                commit: async () => setCommits((n) => n + 1),
                restore: () => setVisible(true),
                focusAfterRestore: () => document.getElementById("remove-pin"),
              });
            }}
          >
            Remove pin
          </button>
        </p>
      )}
      <output id="commits">{commits}</output>
      {undoToast}
    </section>
  );
}

function FormDialogCase() {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  return (
    <section>
      <button id="open-form" onClick={() => setOpen(true)}>
        Quick task
      </button>
      <output id="form-state">{open ? "open" : "closed"}</output>
      {open && (
        <FormDialog
          title="Quick task for Sam"
          dirty={text.trim() !== ""}
          onClose={() => {
            setOpen(false);
            setText("");
          }}
        >
          <label htmlFor="task-title">What needs to be done?</label>
          <input id="task-title" value={text} onChange={(e) => setText(e.target.value)} />
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              setText("");
            }}
          >
            Save task
          </button>
        </FormDialog>
      )}
    </section>
  );
}

createRoot(document.getElementById("root")!).render(
  <>
    <PromptCase />
    <OverlapCase />
    <UnmountCase />
    <UndoCase />
    <FormDialogCase />
  </>,
);
